// Açılış ekranı: oyun sayfası yüklenirken logo, ad ve ilerleme çubuğu.
import 'package:flutter/material.dart';

import 'ayarlar.dart';

class AcilisEkrani extends StatelessWidget {
  const AcilisEkrani({super.key, required this.ilerleme});
  final double ilerleme;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(yesilAcik), Color(yesilKoyu)]),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/logo.png', width: 112, height: 112),
            const SizedBox(height: 18),
            const Text('Sanal Türkiye', style: TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: .3)),
            const SizedBox(height: 6),
            Text('Çiftliğin seni bekliyor', style: TextStyle(color: Colors.white.withValues(alpha: .85), fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 28),
            SizedBox(
              width: 180,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  value: ilerleme > 0.05 ? ilerleme : null,
                  minHeight: 7,
                  backgroundColor: Colors.white.withValues(alpha: .25),
                  valueColor: const AlwaysStoppedAnimation(Color(0xFFFFD45C)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
