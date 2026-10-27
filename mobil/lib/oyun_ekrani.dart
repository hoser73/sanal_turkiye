// Oyun ekranı: tam ekran WebView. Sayfa yüklenene kadar açılış ekranı, bağlantı kurulamazsa çevrimdışı ekranı görünür.
// Oyun sayfası `StMobil` kanalından mesaj gönderir: {"tur":"titresim","guc":"hafif|orta|agir|secim"}.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import 'acilis.dart';
import 'ayarlar.dart';
import 'cevrimdisi.dart';

class OyunEkrani extends StatefulWidget {
  const OyunEkrani({super.key});

  @override
  State<OyunEkrani> createState() => _OyunEkraniState();
}

class _OyunEkraniState extends State<OyunEkrani> with WidgetsBindingObserver {
  late final WebViewController _web;
  final Uri _sunucu = Uri.parse(sunucuAdresi);
  double _ilerleme = 0;
  bool _yuklendi = false;
  bool _baglantiYok = false;
  String? _hata;
  Timer? _gelistirici;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    PlatformWebViewControllerCreationParams parametre = const PlatformWebViewControllerCreationParams();
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      // Oyun sesleri dokunmadan da çalabilsin, videolar satır içinde oynasın
      parametre = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    }
    _web = WebViewController.fromPlatformCreationParams(parametre)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(yesilAcik))
      ..addJavaScriptChannel('StMobil', onMessageReceived: (m) => _mesaj(m.message))
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) => setState(() => _ilerleme = p / 100),
        onPageFinished: (_) => setState(() => _yuklendi = true),
        onWebResourceError: (e) {
          if (e.isForMainFrame ?? true) setState(() { _baglantiYok = true; _hata = kDebugMode ? '${e.errorCode} ${e.description}' : null; });
        },
        onNavigationRequest: _gezinme,
      ));
    final platform = _web.platform;
    if (platform is WebKitWebViewController) {
      platform.setAllowsBackForwardNavigationGestures(true);   // kenardan kaydırınca geri (çiftlikten haritaya)
      platform.setInspectable(kDebugMode);                      // geliştirmede Safari ile incelenebilir
    }
    _web.loadRequest(_sunucu);
    if (kDebugMode) _gelistiriciIzle();
  }

  // Yalnızca geliştirmede: uygulamanın geçici klasörüne yazılan st_js.txt sayfada çalıştırılır (simülatörde ekran
  // görüntüsüyle doğrulama için; klavyeyle yazmadan giriş yapmak, bir sayfaya gitmek gibi). Yayın sürümünde yok.
  void _gelistiriciIzle() {
    final dosya = File('${Directory.systemTemp.path}/st_js.txt');
    _gelistirici = Timer.periodic(const Duration(seconds: 1), (_) async {
      if (!await dosya.exists()) return;
      final js = await dosya.readAsString();
      await dosya.delete();
      try {
        await _web.runJavaScript(js);
      } catch (e) {
        debugPrint('st_js: $e');
      }
    });
  }

  @override
  void dispose() {
    _gelistirici?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Uygulamaya dönünce bağlantı kopmuşsa sayfayı tazele
  @override
  void didChangeAppLifecycleState(AppLifecycleState durum) {
    if (durum == AppLifecycleState.resumed && _baglantiYok) _yeniden();
  }

  // Oyunun kendi adresleri uygulamada açılır; başka siteler (yasal metin bağlantıları vb.) Safari'de
  NavigationDecision _gezinme(NavigationRequest istek) {
    final u = Uri.tryParse(istek.url);
    if (u == null || u.host == _sunucu.host || const {'about', 'blob', 'data'}.contains(u.scheme)) {
      return NavigationDecision.navigate;
    }
    launchUrl(u, mode: LaunchMode.externalApplication);
    return NavigationDecision.prevent;
  }

  void _mesaj(String ham) {
    try {
      final m = jsonDecode(ham) as Map<String, dynamic>;
      if (m['tur'] == 'titresim') {
        switch (m['guc']) {
          case 'agir':
            HapticFeedback.heavyImpact();
          case 'orta':
            HapticFeedback.mediumImpact();
          case 'secim':
            HapticFeedback.selectionClick();
          default:
            HapticFeedback.lightImpact();
        }
      }
    } catch (_) {
      // tanınmayan mesaj
    }
  }

  void _yeniden() {
    setState(() {
      _baglantiYok = false;
      _yuklendi = false;
      _ilerleme = 0;
    });
    _web.loadRequest(_sunucu);
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: const Color(yesilAcik),
        body: Stack(
          children: [
            // Üstte durum çubuğu payı oyunun yeşil üst çubuğuyla aynı renkte; alt pay sayfanın kendisinde (safe-area)
            SafeArea(bottom: false, child: WebViewWidget(controller: _web)),
            if (_baglantiYok) CevrimdisiEkrani(adres: sunucuAdresi, yeniden: _yeniden, ayrinti: _hata),
            IgnorePointer(
              ignoring: _yuklendi,
              child: AnimatedOpacity(
                opacity: _yuklendi || _baglantiYok ? 0 : 1,
                duration: const Duration(milliseconds: 450),
                child: AcilisEkrani(ilerleme: _ilerleme),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
