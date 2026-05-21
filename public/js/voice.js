// Browser speech-to-text support for the composer mic button.

import { dom } from './state.js';
import { toast } from './toast.js';

function appendTranscript(text) {
  const input = dom.input;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
  input.value = before + prefix + text + after;
  const pos = (before + prefix + text).length;
  input.selectionStart = input.selectionEnd = pos;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

export function initVoiceInput() {
  if (!dom.voiceBtn) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    dom.voiceBtn.disabled = true;
    dom.voiceBtn.title = 'Voice input is not supported in this browser';
    dom.voiceBtn.addEventListener('click', () => toast('Voice input is not supported in this browser.'));
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = navigator.language || 'en-US';
  let listening = false;

  const setListening = (on) => {
    listening = on;
    dom.voiceBtn.classList.toggle('recording', on);
    dom.voiceBtn.title = on ? 'Stop voice input' : 'Voice input';
  };

  dom.voiceBtn.addEventListener('click', () => {
    try {
      if (listening) recognition.stop();
      else { setListening(true); recognition.start(); }
    } catch (e) {
      setListening(false);
      toast(`Voice input failed: ${e.message}`);
    }
  });

  recognition.addEventListener('result', (e) => {
    const transcript = [...e.results].map(r => r[0]?.transcript ?? '').join(' ').trim();
    if (transcript) appendTranscript(transcript);
  });
  recognition.addEventListener('error', (e) => {
    setListening(false);
    toast(`Voice input error: ${e.error ?? 'unknown'}`);
  });
  recognition.addEventListener('end', () => setListening(false));
}
