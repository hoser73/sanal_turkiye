// Bağlantı kurulamadığında: sunucuya ulaşılamıyor ekranı ve "Tekrar dene".
import 'package:flutter/material.dart';

import 'ayarlar.dart';

class CevrimdisiEkrani extends StatelessWidget {
  const CevrimdisiEkrani({super.key, required this.adres, required this.yeniden, this.ayrinti});
  final String adres;
  final String? ayrinti;   // hata açıklaması (yalnızca geliştirmede gösterilir)
  final VoidCallback yeniden;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFF6F3EC),
      padding: const EdgeInsets.all(28),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.agriculture_rounded, size: 72, color: Color(yesilKoyu)),
            const SizedBox(height: 14),
            const Text('Çiftliğe ulaşılamıyor', textAlign: TextAlign.center, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Color(zumrut))),
            const SizedBox(height: 10),
            const Text(
              'İnternet bağlantını kontrol edip tekrar dene. Sorun sürerse oyun sunucusu kısa bir bakımda olabilir.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 15.5, height: 1.4, color: Color(0xFF4A5A50)),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: yeniden,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tekrar dene', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              style: FilledButton.styleFrom(backgroundColor: const Color(yesilKoyu), padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 14)),
            ),
            const SizedBox(height: 16),
            Text(ayrinti == null ? adres : '$adres\n$ayrinti', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Color(0xFF8A968E))),
          ],
        ),
      ),
    );
  }
}
