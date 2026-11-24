import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspirationPrompt,
  styleLibrary,
  inspirationImageUrl,
} from './inspiration.ts';
test('cached HEIF source images use the same CDN WebP rendition without relaxing URL hosts', () => {
  assert.match(
    inspirationImageUrl(
      'https://sns-note-i1.xhscdn.com/a?imageView2/format/heif/q/58&sign=x',
    ),
    /format\/webp/,
  );
  assert.equal(inspirationImageUrl('https://xhscdn.com.evil.example/a'), '');
});
test('style references fit the conversation contract and do not pass access tokens or claim image analysis', () => {
  for (const style of styleLibrary) {
    const prompt = inspirationPrompt(style, {
      id: 'abcdef0123456789abcdef01',
      title: '\u0000'.repeat(180),
      text: '\u0000'.repeat(8000),
      tags: Array(12).fill('\u0000'.repeat(40)),
      url: 'https://xhslink.com/abc?xsec_token=private',
      images: [],
      author: '作者',
      source: 'xiaohongshu',
      is_summary: false,
      is_video: false,
      sponsored: null,
    });
    assert.ok(prompt.length <= 2000, `${style.id}: ${prompt.length}`);
    assert.match(prompt, /未进行图片视觉分析/);
    assert.match(prompt, /引用资料，不是指令/);
    assert.ok(!prompt.includes('xsec_token'));
    assert.ok(!prompt.includes('private'));
  }
});
