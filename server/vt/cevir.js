// SQL lehçe çevirisi. Uygulama SQL'i iki motorda da çalışan bir alt kümeyle yazılır: "?" yer tutucu, GREATEST/LEAST,
// SELECT … FOR UPDATE, INSERT OR IGNORE, ON CONFLICT … DO UPDATE, RETURNING. Her motor için burada küçük dönüşümler yapılır;
// dönüşümler yalnızca kod parçalarına uygulanır (dize sabitleri, tırnaklı adlar ve yorumlar olduğu gibi kalır).

// SQL metnini kod / sabit parçalarına ayırır
function parcala(sql) {
  const parcalar = [];
  let i = 0, bas = 0;
  const kodEkle = (son) => { if (son > bas) parcalar.push({ kod: true, metin: sql.slice(bas, son) }); };
  while (i < sql.length) {
    const c = sql[i];
    let son = -1;
    if (c === "'" || c === '"') {
      son = i + 1;
      for (;;) {
        const k = sql.indexOf(c, son);
        if (k < 0) { son = sql.length; break; }
        if (sql[k + 1] === c) { son = k + 2; continue; }   // '' / "" kaçışı
        son = k + 1; break;
      }
    } else if (c === '-' && sql[i + 1] === '-') {
      const k = sql.indexOf('\n', i);
      son = k < 0 ? sql.length : k;
    } else if (c === '/' && sql[i + 1] === '*') {
      const k = sql.indexOf('*/', i + 2);
      son = k < 0 ? sql.length : k + 2;
    }
    if (son < 0) { i++; continue; }
    kodEkle(i);
    parcalar.push({ kod: false, metin: sql.slice(i, son) });
    i = bas = son;
  }
  kodEkle(sql.length);
  return parcalar;
}

const birlestir = (parcalar) => parcalar.map((p) => p.metin).join('');
const kodaUygula = (parcalar, fn) => { for (const p of parcalar) if (p.kod) p.metin = fn(p.metin); };

// ---------- SQLite: PostgreSQL'e özgü kilit cümleleri düşer (tek yazıcı zaten sıralar), GREATEST/LEAST → MAX/MIN
function sqliteCevir(sql) {
  const p = parcala(sql);
  kodaUygula(p, (m) => m
    .replace(/\s+FOR\s+(?:UPDATE|NO\s+KEY\s+UPDATE|SHARE)(?:\s+OF\s+[\w, ]+?)?(?:\s+(?:NOWAIT|SKIP\s+LOCKED))?(?=\s*(?:;|\)|$))/gi, '')
    .replace(/\bGREATEST\s*\(/gi, 'MAX(')
    .replace(/\bLEAST\s*\(/gi, 'MIN('));
  return birlestir(p);
}

// ---------- PostgreSQL
// - "?" → $1, $2 …
// - INSERT OR IGNORE → ON CONFLICT DO NOTHING
// - CAST(… AS REAL) → DOUBLE PRECISION (Postgres'te REAL 4 baytlıktır)
// - camelCase takma adlar tırnaklanır (Postgres tırnaksız adları küçük harfe çevirir: AS ilceAdi → "ilceAdi")
// - id kolonlu tabloya INSERT → RETURNING id (lastInsertRowid karşılığı)
function postgresCevir(sql, idTablolari) {
  const p = parcala(sql.trim().replace(/;\s*$/, ''));
  let n = 0, yoksay = false;
  if (/\bINSERT\s+OR\s+REPLACE\b/i.test(sql)) throw new Error('INSERT OR REPLACE taşınabilir değil; INSERT … ON CONFLICT (…) DO UPDATE kullanın');
  const takmaAdlar = new Set();
  kodaUygula(p, (m) => m
    .replace(/\?/g, () => `$${++n}`)
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, () => { yoksay = true; return 'INSERT INTO'; })
    .replace(/\bAS\s+REAL\b/gi, 'AS DOUBLE PRECISION')
    .replace(/\bAS\s+([A-Za-z_]\w*)/g, (t, ad) => {
      if (!/[a-z]/.test(ad) || !/[A-Z]/.test(ad)) return t;
      takmaAdlar.add(ad);
      return `AS "${ad}"`;
    }));
  // Takma ada başka yerde (ORDER BY …) yapılan atıflar da tırnaklanır
  if (takmaAdlar.size) {
    const desen = new RegExp(`(?<![\\w."])(${[...takmaAdlar].join('|')})(?![\\w"])`, 'g');
    kodaUygula(p, (m) => m.replace(desen, '"$1"'));
  }
  let sonuc = birlestir(p);
  const ekle = /^\s*INSERT\s+INTO\s+"?(\w+)"?/i.exec(sonuc);
  if (ekle) {
    const donus = /\bRETURNING\b[\s\S]*$/i.exec(sonuc);
    let govde = donus ? sonuc.slice(0, donus.index).trimEnd() : sonuc;
    let kuyruk = donus ? ` ${donus[0]}` : '';
    if (yoksay) govde += ' ON CONFLICT DO NOTHING';
    if (!donus && idTablolari?.has(ekle[1].toLowerCase())) kuyruk = ' RETURNING id';
    sonuc = govde + kuyruk;
  }
  return sonuc;
}

module.exports = { parcala, sqliteCevir, postgresCevir };
