// Tarayıcı tarafı WebAuthn (passkey): sunucunun JSON seçeneklerini tarayıcı API'sine çevirir, yanıtı JSON'a geri çevirir.
const b64u = {
  cevir: (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer; },
  yaz: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
};

export const passkeyDestekli = () => typeof window.PublicKeyCredential === 'function' && !!navigator.credentials?.create;

export async function passkeyOlustur(sec) {
  const publicKey = { ...sec, challenge: b64u.cevir(sec.challenge), user: { ...sec.user, id: b64u.cevir(sec.user.id) },
    excludeCredentials: (sec.excludeCredentials || []).map((c) => ({ ...c, id: b64u.cevir(c.id) })) };
  const k = await navigator.credentials.create({ publicKey });
  return { id: k.id, rawId: b64u.yaz(k.rawId), type: k.type, authenticatorAttachment: k.authenticatorAttachment || undefined,
    clientExtensionResults: k.getClientExtensionResults?.() || {},
    response: { clientDataJSON: b64u.yaz(k.response.clientDataJSON), attestationObject: b64u.yaz(k.response.attestationObject),
      transports: k.response.getTransports?.() || [] } };
}

export async function passkeyImzala(sec) {
  const publicKey = { ...sec, challenge: b64u.cevir(sec.challenge), allowCredentials: (sec.allowCredentials || []).map((c) => ({ ...c, id: b64u.cevir(c.id) })) };
  const k = await navigator.credentials.get({ publicKey });
  return { id: k.id, rawId: b64u.yaz(k.rawId), type: k.type, clientExtensionResults: k.getClientExtensionResults?.() || {},
    response: { clientDataJSON: b64u.yaz(k.response.clientDataJSON), authenticatorData: b64u.yaz(k.response.authenticatorData),
      signature: b64u.yaz(k.response.signature), userHandle: k.response.userHandle ? b64u.yaz(k.response.userHandle) : undefined } };
}

// Kullanıcı vazgeçti mi (iptal, zaman aşımı) — hata mesajı göstermeye gerek yok
export const iptalMi = (e) => e?.name === 'NotAllowedError' || e?.name === 'AbortError';
