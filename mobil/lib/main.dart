// Sanal Türkiye iOS uygulaması: oyunun kendisi sunucudan WebView içinde çalışır (harita, 3B çiftlik, panel);
// Flutter kabuğu açılış ekranını, çevrimdışı ekranını, dokunsal geri bildirimi ve dış bağlantıları üstlenir.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'ayarlar.dart';
import 'oyun_ekrani.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp, DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
  runApp(const SanalTurkiye());
}

class SanalTurkiye extends StatelessWidget {
  const SanalTurkiye({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Sanal Türkiye',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(yesilKoyu)),
      ),
      home: const OyunEkrani(),
    );
  }
}
