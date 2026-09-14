const Voice = (() => {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let enabled = true;
  let voice = null;
  let recognizer = null;

  const PREFERRED = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Ava', 'Allison', 'Karen', 'Victoria', 'Zira'];

  function pickVoice() {
    const all = synth ? synth.getVoices() : [];
    voice = PREFERRED.map((n) => all.find((v) => v.name.includes(n) && /^en/i.test(v.lang))).find(Boolean)
      || all.find((v) => /en-US/i.test(v.lang))
      || all.find((v) => /^en/i.test(v.lang))
      || null;
  }
  if (synth) {
    pickVoice();
    synth.onvoiceschanged = pickVoice;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function speak(text) {
    const readTime = Math.min(2600, Math.max(700, text.length * 28));
    if (!enabled || !synth) return wait(readTime);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.04;
      u.pitch = 1.05;
      u.onend = finish;
      u.onerror = finish;
      synth.cancel();
      synth.speak(u);
      setTimeout(finish, text.length * 95 + 4000);
    });
  }

  function stopSpeaking() { if (synth) synth.cancel(); }

  function listen({ onInterim, onFinal, onEnd, onError }) {
    if (!SR) return () => {};
    stopListening();
    const r = new SR();
    recognizer = r;
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      onInterim?.(finalText + interim);
    };
    r.onerror = (e) => onError?.(e.error);
    r.onend = () => {
      if (recognizer === r) recognizer = null;
      if (finalText.trim()) onFinal?.(finalText.trim());
      onEnd?.();
    };
    try { r.start(); } catch (err) { onError?.(err.message); }
    return () => r.stop();
  }

  function stopListening() {
    if (recognizer) { try { recognizer.abort(); } catch { /* already stopped */ } recognizer = null; }
  }

  return {
    speak, stopSpeaking, listen, stopListening,
    supported: { tts: !!synth, stt: !!SR },
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; if (!v) stopSpeaking(); },
  };
})();
