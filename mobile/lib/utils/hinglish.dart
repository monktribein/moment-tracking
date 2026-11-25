/// Writes Hindi in Roman letters — Hinglish — the way people type it in
/// chats: "कमरा कितने का है" becomes "kamra kitne ka hai".
///
/// The phone's speech recogniser returns Hindi in Devanagari; agents want
/// Hinglish. Anything that isn't Devanagari (English words, numbers,
/// punctuation) is left exactly as it is, so English text passes through
/// unchanged and converting twice is harmless.
///
/// Works on the phone with spelling rules (including Hindi's silent "a":
/// कमरा is "kamra", not "kamaraa") plus a short list of very common words
/// whose usual Hinglish spelling the rules can't guess ("mein", "nahi",
/// "hotel", "room").
String toHinglish(String text) {
  if (!_hasDevanagari(text)) return text;
  final out = StringBuffer();
  final word = StringBuffer();
  void endWord() {
    if (word.isEmpty) return;
    final raw = word.toString();
    String spelled;
    try {
      spelled = _word(raw);
    } catch (_) {
      spelled = raw; // Never lose words: keep one we can't spell as it is.
    }
    out.write(spelled.isEmpty ? raw : spelled);
    word.clear();
  }

  for (final rune in text.runes) {
    if (_isWordRune(rune)) {
      word.writeCharCode(rune);
    } else {
      endWord();
      out.write(_otherRune(rune));
    }
  }
  endWord();
  return out.toString();
}

bool _hasDevanagari(String text) {
  for (final unit in text.codeUnits) {
    if (unit >= 0x0900 && unit <= 0x097F) return true;
  }
  return false;
}

bool _isWordRune(int r) =>
    (r >= 0x0900 && r <= 0x097F && !_isPunctuationOrDigit(r)) ||
    r == 0x200C || // zero-width non-joiner
    r == 0x200D; // zero-width joiner

bool _isPunctuationOrDigit(int r) =>
    r == 0x0964 || r == 0x0965 || r == 0x0970 || (r >= 0x0966 && r <= 0x096F);

String _otherRune(int r) {
  if (r == 0x0964 || r == 0x0965 || r == 0x0970) return '.'; // । ॥ ॰
  if (r >= 0x0966 && r <= 0x096F) return '${r - 0x0966}'; // ०-९
  return String.fromCharCode(r);
}

String _word(String raw) {
  final word = _normalize(raw);
  return _commonWords[word] ?? _spell(word);
}

// ── Letters ──────────────────────────────────────────────────────────────

const _nukta = 0x093C;
const _virama = 0x094D;
const _anusvara = 0x0902;
const _chandrabindu = 0x0901;
const _visarga = 0x0903;

const _consonants = {
  0x0915: 'k', 0x0916: 'kh', 0x0917: 'g', 0x0918: 'gh', 0x0919: 'n', //
  0x091A: 'ch', 0x091B: 'chh', 0x091C: 'j', 0x091D: 'jh', 0x091E: 'n',
  0x091F: 't', 0x0920: 'th', 0x0921: 'd', 0x0922: 'dh', 0x0923: 'n',
  0x0924: 't', 0x0925: 'th', 0x0926: 'd', 0x0927: 'dh', 0x0928: 'n',
  0x092A: 'p', 0x092B: 'ph', 0x092C: 'b', 0x092D: 'bh', 0x092E: 'm',
  0x092F: 'y', 0x0930: 'r', 0x0932: 'l', 0x0933: 'l', 0x0935: 'v',
  0x0936: 'sh', 0x0937: 'sh', 0x0938: 's', 0x0939: 'h',
};

/// Consonants written with a dot below (nukta): क़ ख़ ग़ ज़ ड़ ढ़ फ़ य़ ...
const _nuktaForms = {
  0x0915: 'q', 0x0916: 'kh', 0x0917: 'g', 0x091C: 'z', 0x0921: 'd', //
  0x0922: 'dh', 0x092B: 'f', 0x092F: 'y', 0x0928: 'n', 0x0930: 'r',
  0x0933: 'l',
};

/// Single code points that mean consonant + nukta.
const _precomposedNukta = {
  0x0958: 0x0915, 0x0959: 0x0916, 0x095A: 0x0917, 0x095B: 0x091C, //
  0x095C: 0x0921, 0x095D: 0x0922, 0x095E: 0x092B, 0x095F: 0x092F,
  0x0929: 0x0928, 0x0931: 0x0930, 0x0934: 0x0933,
};

/// Vowel signs after a consonant, and independent vowels. Long vowels are
/// written "aa", "ee", "oo" (see [_Unit] for when they are shortened).
const _vowelSigns = {
  0x093E: 'aa', 0x093F: 'i', 0x0940: 'ee', 0x0941: 'u', 0x0942: 'oo', //
  0x0943: 'ri', 0x0944: 'ri', 0x0945: 'e', 0x0946: 'e', 0x0947: 'e',
  0x0948: 'ai', 0x0949: 'o', 0x094A: 'o', 0x094B: 'o', 0x094C: 'au',
};

const _independentVowels = {
  0x0905: 'a', 0x0906: 'aa', 0x0907: 'i', 0x0908: 'ee', 0x0909: 'u', //
  0x090A: 'oo', 0x090B: 'ri', 0x090D: 'e', 0x090E: 'e', 0x090F: 'e',
  0x0910: 'ai', 0x0911: 'o', 0x0912: 'o', 0x0913: 'o', 0x0914: 'au',
};

const _shortForms = {'aa': 'a', 'ee': 'i', 'oo': 'u'};

const _labials = {0x092A, 0x092B, 0x092C, 0x092D, 0x092E}; // प फ ब भ म
const _va = 0x0935, _ja = 0x091C, _nya = 0x091E, _ca = 0x091A, _cha = 0x091B;
const _independentE = 0x090F;
const _signAa = 0x093E;

/// Decomposes nukta letters, treats ँ like ं and drops zero-width joiners,
/// so the same word always looks the same.
String _normalize(String word) {
  final out = StringBuffer();
  for (final r in word.runes) {
    if (r == 0x200C || r == 0x200D) continue;
    final base = _precomposedNukta[r];
    if (base != null) {
      out
        ..writeCharCode(base)
        ..writeCharCode(_nukta);
    } else {
      out.writeCharCode(r == _chandrabindu ? _anusvara : r);
    }
  }
  return out.toString();
}

/// One consonant with its vowel, or one independent vowel.
class _Unit {
  _Unit.consonant(int this.code, this.letters);
  _Unit.vowel(this.vowel) : code = null, letters = '';

  final int? code; // the consonant's code point; null for a vowel
  String letters;
  String? vowel; // null: the consonant's built-in "a"
  int? vowelCode;
  bool virama = false; // joined to the next consonant, no vowel
  bool nasal = false;
  bool visarga = false;
  bool silentA = false; // built-in "a" not pronounced

  bool get isConsonant => code != null;
  bool get hasBuiltInA => isConsonant && vowel == null && !virama;
  bool get endsInVowel =>
      !isConsonant || (!virama && !(hasBuiltInA && silentA));
}

String _spell(String word) {
  final units = _parse(word);
  if (units.isEmpty) return '';
  _joinSpecialClusters(units);
  _markSilentA(units);

  final n = units.length;
  final firstSyllable = units.indexWhere((u) => !u.virama);
  final out = StringBuffer();
  for (var i = 0; i < n; i++) {
    final u = units[i];
    final next = i + 1 < n ? units[i + 1] : null;

    if (u.code == _va) {
      // व: "w" in wala, sawal, swagat; "v" in vikas, ved, vyakti.
      final inCluster = i > 0 && units[i - 1].virama;
      final w =
          inCluster ||
          (u.hasBuiltInA && !u.silentA) ||
          const {'aa', 'ai', 'o', 'au'}.contains(u.vowel);
      u.letters = w ? 'w' : 'v';
    }
    out.write(u.letters);

    var vowel = u.isConsonant
        ? (u.virama ? '' : (u.vowel ?? (u.silentA ? '' : 'a')))
        : u.vowel!;
    final short = _shortForms[vowel];
    if (short != null) {
      final bool keepLong;
      if (next == null) {
        keepLong = n == 1 && !u.isConsonant; // "आ" on its own is "aa"
      } else {
        // Long only in the first syllable: aap, baat, theek; but hamara,
        // mahina, and jao/jaye (ा before a vowel).
        keepLong =
            i == firstSyllable &&
            !(u.vowelCode == _signAa && !next.isConsonant);
      }
      if (!keepLong) vowel = short;
    }
    if (!u.isConsonant &&
        u.vowelCode == _independentE &&
        i > 0 &&
        units[i - 1].endsInVowel) {
      vowel = 'ye'; // गए gaye, लिए liye, जाए jaye
    }
    out.write(vowel);

    if (u.nasal) {
      out.write(next != null && _labials.contains(next.code) ? 'm' : 'n');
    }
    if (u.visarga) out.write('h');
  }
  return out.toString();
}

List<_Unit> _parse(String word) {
  final units = <_Unit>[];
  final runes = word.runes.toList();
  for (var i = 0; i < runes.length; i++) {
    final r = runes[i];
    final consonant = _consonants[r];
    if (consonant != null) {
      var letters = consonant;
      if (i + 1 < runes.length && runes[i + 1] == _nukta) {
        letters = _nuktaForms[r] ?? consonant;
        i++;
      }
      units.add(_Unit.consonant(r, letters));
      continue;
    }
    final last = units.isEmpty ? null : units.last;
    if (last != null) {
      final open = last.isConsonant && last.vowel == null && !last.virama;
      if (r == _virama && open) {
        last.virama = true;
        continue;
      }
      final sign = _vowelSigns[r];
      if (sign != null) {
        if (open) {
          last
            ..vowel = sign
            ..vowelCode = r;
        }
        continue;
      }
      if (r == _anusvara) {
        last.nasal = true;
        continue;
      }
      if (r == _visarga) {
        last.visarga = true;
        continue;
      }
    }
    final vowel = _independentVowels[r];
    if (vowel != null) units.add(_Unit.vowel(vowel)..vowelCode = r);
    // Anything else (a stray sign, avagraha) is not pronounced.
  }
  return units;
}

void _joinSpecialClusters(List<_Unit> units) {
  for (var i = 0; i + 1 < units.length; i++) {
    final a = units[i], b = units[i + 1];
    if (!a.virama) continue;
    if (a.code == _ja && b.code == _nya) {
      a.letters = 'g'; // ज्ञान gyaan
      b.letters = 'y';
    } else if (a.code == _ca && (b.code == _ca || b.code == _cha)) {
      a.letters = 'c'; // बच्चा baccha, अच्छा accha
      b.letters = 'ch';
    }
  }
}

/// Hindi doesn't say every written "a": कमरा is kam-ra, समझना is
/// sa-majh-na. The usual rules: the last one is silent, and one between
/// two consonants that each have a vowel around them is silent (checked
/// right to left).
void _markSilentA(List<_Unit> units) {
  final n = units.length;
  final last = units[n - 1];
  if (n > 1 && last.hasBuiltInA && !last.nasal && !last.visarga) {
    final prev = units[n - 2];
    // ...but kept after a joined consonant ending in र/य/व: mitra, satya.
    final kept =
        prev.virama && const {0x0930, 0x092F, 0x0935}.contains(last.code);
    if (!kept) last.silentA = true;
  }
  for (var i = n - 2; i >= 1; i--) {
    final u = units[i];
    if (!u.hasBuiltInA || u.nasal || u.visarga) continue;
    final left = units[i - 1], right = units[i + 1];
    if (!left.endsInVowel) continue;
    if (!right.isConsonant || right.virama) continue;
    if (right.hasBuiltInA && right.silentA) continue;
    u.silentA = true;
  }
}

// ── Common words ─────────────────────────────────────────────────────────

/// The usual Hinglish spelling of very common words, and English words the
/// recogniser writes in Devanagari (होटल → hotel).
final Map<String, String> _commonWords = {
  for (final e in _commonWordList.entries) _normalize(e.key): e.value,
};

const _commonWordList = {
  // Hindi
  'में': 'mein', 'नहीं': 'nahi', 'नही': 'nahi', 'हाँ': 'haan',
  'क्यों': 'kyun', 'क्यूँ': 'kyun', 'यह': 'yeh', 'वह': 'woh', 'हम': 'hum',
  'हूँ': 'hoon', 'कुछ': 'kuch', 'चाहिए': 'chahiye', 'चाहिये': 'chahiye',
  'लिए': 'liye', 'लिये': 'liye', 'दीजिए': 'dijiye', 'दीजिये': 'dijiye',
  'लीजिए': 'lijiye', 'लीजिये': 'lijiye', 'कीजिए': 'kijiye',
  'कीजिये': 'kijiye', 'शायद': 'shayad', 'ज़्यादा': 'zyada',
  'ज्यादा': 'zyada', 'लाख': 'lakh', 'मालिक': 'malik', 'वाला': 'wala',
  'वाली': 'wali', 'वाले': 'wale', 'पहले': 'pehle', 'पहला': 'pehla',
  'पहली': 'pehli', 'रुपये': 'rupaye', 'रुपए': 'rupaye', 'रूपये': 'rupaye',
  'रुपया': 'rupaya', 'सिर्फ': 'sirf', 'सिर्फ़': 'sirf', 'गाँव': 'gaon',
  'माँ': 'maa', 'अच्छा': 'accha', 'अच्छी': 'acchi', 'अच्छे': 'acche',
  'मैंने': 'maine', 'जाएगा': 'jayega', 'जाएगी': 'jayegi',
  'जाएंगे': 'jayenge', 'आइए': 'aaiye', 'सर': 'sir', 'मैडम': 'madam',
  'वर्मा': 'verma', 'इंडिया': 'India', 'इंग्लिश': 'English',
  'हैलो': 'hello', 'हेलो': 'hello', 'हलो': 'hello', 'ओके': 'ok',
  // English words in hotel / guest-house conversations
  'होटल': 'hotel', 'गेस्ट': 'guest', 'हाउस': 'house',
  'गेस्टहाउस': 'guesthouse', 'रूम': 'room', 'रूम्स': 'rooms',
  'बुकिंग': 'booking', 'बुक': 'book', 'नंबर': 'number', 'नम्बर': 'number',
  'फोन': 'phone', 'मोबाइल': 'mobile', 'ओनर': 'owner', 'मैनेजर': 'manager',
  'प्राइस': 'price', 'रेट': 'rate', 'रेट्स': 'rates', 'रेंट': 'rent',
  'डिस्काउंट': 'discount', 'ऑफर': 'offer', 'एसी': 'AC', 'नॉन': 'non',
  'डबल': 'double', 'सिंगल': 'single', 'बेड': 'bed', 'पार्किंग': 'parking',
  'वाईफाई': 'wifi', 'कस्टमर': 'customer', 'कस्टमर्स': 'customers',
  'मीटिंग': 'meeting', 'विजिट': 'visit', 'लीड': 'lead', 'थैंक': 'thank',
  'थैंक्स': 'thanks', 'यू': 'you', 'प्लीज': 'please', 'सॉरी': 'sorry',
  'टाइम': 'time', 'डेट': 'date', 'लोकेशन': 'location', 'एड्रेस': 'address',
  'सिटी': 'city', 'डिस्ट्रिक्ट': 'district', 'एरिया': 'area',
  'स्टाफ': 'staff', 'सर्विस': 'service', 'फैमिली': 'family',
  'ग्रुप': 'group', 'चेक': 'check', 'चेकइन': 'check-in',
  'चेकआउट': 'check-out', 'आउट': 'out', 'कैश': 'cash', 'ऑनलाइन': 'online',
  'पेमेंट': 'payment', 'यूपीआई': 'UPI', 'जीएसटी': 'GST', 'टोटल': 'total',
  'परसेंट': 'percent', 'पर्सेंट': 'percent', 'ऑफिस': 'office',
  'कॉल': 'call', 'मैसेज': 'message', 'व्हाट्सएप': 'WhatsApp',
  'व्हाट्सऐप': 'WhatsApp', 'ईमेल': 'email', 'सीजन': 'season',
  'टूरिस्ट': 'tourist', 'स्टेशन': 'station', 'डॉक्टर': 'doctor',
  'फ्लोर': 'floor', 'लिफ्ट': 'lift', 'किचन': 'kitchen',
  'बाथरूम': 'bathroom', 'टॉयलेट': 'toilet', 'गीजर': 'geyser', 'टीवी': 'TV',
  'फ्री': 'free', 'चार्ज': 'charge', 'चार्जेस': 'charges',
  'एक्स्ट्रा': 'extra', 'ब्रेकफास्ट': 'breakfast', 'डिनर': 'dinner',
  'लंच': 'lunch', 'फूड': 'food', 'रिसेप्शन': 'reception',
  'प्रॉपर्टी': 'property', 'बिल्डिंग': 'building', 'होमस्टे': 'homestay',
  'लॉज': 'lodge', 'रिसॉर्ट': 'resort', 'बजट': 'budget', 'डीलक्स': 'deluxe',
  'मार्केट': 'market', 'बाय': 'bye', 'गुड': 'good', 'मॉर्निंग': 'morning',
  'नाइट': 'night', 'फाइनल': 'final', 'कन्फर्म': 'confirm',
  'कंफर्म': 'confirm', 'एडवांस': 'advance', 'रिफंड': 'refund', 'ऐप': 'app',
  'वेबसाइट': 'website', 'गूगल': 'Google', 'मैप': 'map', 'रिव्यू': 'review',
  'रेटिंग': 'rating', 'स्टार': 'star', 'क्लीन': 'clean', 'मिनट': 'minute',
  'सेकंड': 'second', 'वीक': 'week', 'मंथ': 'month', 'नेक्स्ट': 'next',
  'लास्ट': 'last', 'फर्स्ट': 'first', 'प्लान': 'plan', 'पैकेज': 'package',
  'इंटरेस्टेड': 'interested', 'इंटरेस्ट': 'interest', 'बिजी': 'busy',
  'कॉन्टैक्ट': 'contact', 'डिटेल': 'detail', 'डिटेल्स': 'details',
  'फॉर्म': 'form', 'एग्रीमेंट': 'agreement', 'कमीशन': 'commission',
  'पार्टनर': 'partner',
  // The same words written with a nukta (फ़, ज़)
  'फ़ोन': 'phone', 'ऑफ़र': 'offer', 'वाईफ़ाई': 'wifi', 'स्टाफ़': 'staff',
  'फ़ैमिली': 'family', 'विज़िट': 'visit', 'प्लीज़': 'please',
  'सीज़न': 'season', 'गीज़र': 'geyser', 'बिज़ी': 'busy', 'ऑफ़िस': 'office',
  'फ़्री': 'free', 'फ़ाइनल': 'final', 'फ़्लोर': 'floor', 'फ़ूड': 'food',
};
