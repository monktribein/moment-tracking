import 'package:flutter_test/flutter_test.dart';
import 'package:movement_tracking/utils/hinglish.dart';

void main() {
  test('Hindi sentences come out the way people type Hinglish', () {
    const cases = {
      'कट किसको': 'kat kisko',
      'आप कैसे हैं': 'aap kaise hain',
      'कमरा कितने का है': 'kamra kitne ka hai',
      'मुझे समझना है': 'mujhe samajhna hai',
      'ठीक है, कल मिलते हैं।': 'theek hai, kal milte hain.',
      'नमस्ते जी': 'namaste ji',
      'हम मिलकर काम करेंगे': 'hum milkar kaam karenge',
      'अपना नंबर दीजिए': 'apna number dijiye',
      'यहाँ नहीं वहाँ': 'yahan nahi wahan',
      'मालिक से बात हुई': 'malik se baat hui',
      'सवाल का जवाब': 'sawal ka jawab',
      'बच्चा अच्छा है': 'baccha accha hai',
      'पानी चाहिए': 'paani chahiye',
      'वो लोग आए थे': 'wo log aaye the',
      'जाओ और बताओ': 'jao aur batao',
      'हमारा महीना किराया': 'hamara mahina kiraya',
      'ज़रूर मिलेगा': 'zarur milega',
      'संपर्क हिंदी': 'sampark hindi',
      'विश्वास मित्र ज्ञान': 'vishwas mitra gyaan',
      'मतलब समझदार': 'matlab samajhdar',
    };
    cases.forEach((hindi, hinglish) {
      expect(toHinglish(hindi), hinglish, reason: hindi);
    });
  });

  test('English words the recogniser writes in Devanagari become English', () {
    expect(
      toHinglish('होटल में 20 रूम हैं, एसी और पार्किंग फ्री'),
      'hotel mein 20 room hain, AC aur parking free',
    );
    expect(toHinglish('ओनर का फ़ोन नंबर'), 'owner ka phone number');
  });

  test('English and numbers are left exactly as they are', () {
    const english = 'Owner is interested in 20 rooms, call him at 5 PM.';
    expect(toHinglish(english), english);
    expect(toHinglish(''), '');
    expect(toHinglish('मेरा phone नंबर'), 'mera phone number');
    expect(toHinglish('२० कमरे'), '20 kamre');
  });

  test('converting twice changes nothing', () {
    final once = toHinglish('कमरा कितने का है');
    expect(toHinglish(once), once);
  });
}
