import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useSpeechSynthesis } from 'react-speech-kit';

export default function App() {
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const { speak } = useSpeechSynthesis();

  const login = useGoogleLogin({
    onSuccess: tokenResponse => console.log(tokenResponse),
  });

  const translateText = async (text) => {
    setIsTranslating(true);
    const data = { translation: `Translated: ${text}` };
    setTranslatedText(data.translation);
    speak({ text: data.translation });
    setIsTranslating(false);
  };

  const simulateVoiceInput = () => {
    const simulatedSpeech = "بغيت نمشي للدار البيضاء";
    setSourceText(simulatedSpeech);
    translateText(simulatedSpeech);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>مترجم فوري صوتي</h1>
      <button onClick={() => login()}>تسجيل الدخول بجوجل</button>
      <div style={{ marginTop: 10 }}>
        <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
          <option value="auto">تلقائي</option>
          <option value="ar">العربية</option>
          <option value="fr">الفرنسية</option>
          <option value="en">الإنجليزية</option>
        </select>
        <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} style={{ marginLeft: 10 }}>
          <option value="en">الإنجليزية</option>
          <option value="ar">العربية</option>
          <option value="fr">الفرنسية</option>
        </select>
      </div>
      <textarea
        placeholder="اكتب أو استخدم الميكروفون"
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
        style={{ display: 'block', width: '100%', marginTop: 10, height: 100 }}
      />
      <div>
        <button onClick={() => translateText(sourceText)} disabled={isTranslating}>
          {isTranslating ? 'جار الترجمة...' : 'ترجم الآن'}
        </button>
        <button onClick={simulateVoiceInput} style={{ marginLeft: 10 }}>
          تسجيل صوتي تجريبي
        </button>
      </div>
      {translatedText && (
        <div style={{ backgroundColor: '#f0f0f0', padding: 10, marginTop: 10 }}>
          <strong>الترجمة:</strong>
          <p>{translatedText}</p>
        </div>
      )}
    </div>
  );
}
