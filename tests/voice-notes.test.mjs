import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareVoice, voiceFormat, MAX_VOICE_BYTES } from '../lib/voice-notes.ts';

test('voice uploads reject empty, oversized, unsupported and mislabeled files', async () => {
  await assert.rejects(prepareVoice(new File([], 'empty.wav', { type: 'audio/wav' })), /empty/);
  await assert.rejects(prepareVoice(new File([new Uint8Array(MAX_VOICE_BYTES + 1)], 'big.wav', { type: 'audio/wav' })), /5 MB/);
  await assert.rejects(prepareVoice(new File(['<html>'], 'bad.html', { type: 'text/html' })), /audio file/);
  await assert.rejects(prepareVoice(new File(['pretend audio'], 'bad.wav', { type: 'audio/wav' })), /does not match/);
});
test('supported browser recording types and filename fallbacks normalize safely', () => {
  assert.deepEqual(voiceFormat('audio/webm;codecs=opus'), { mime: 'audio/webm', extension: 'webm' });
  assert.deepEqual(voiceFormat('audio/x-m4a'), { mime: 'audio/mp4', extension: 'm4a' });
  assert.deepEqual(voiceFormat('', 'RECORDING.WAV'), { mime: 'audio/wav', extension: 'wav' });
  assert.throws(() => voiceFormat('text/html', 'disguised.mp3'), /audio file/);
});
test('a supported audio header yields an immutable random draft identity', async () => {
  const wav = new File(['RIFF', new Uint8Array(4), 'WAVE', new Uint8Array(32)], 'note.wav', { type: 'audio/x-wav' });
  const first = await prepareVoice(wav); const second = await prepareVoice(wav);
  assert.equal(first.file, wav); assert.equal(first.mime, 'audio/wav');
  assert.match(first.id, /^[0-9a-f-]{36}$/); assert.notEqual(first.id, second.id);
});
