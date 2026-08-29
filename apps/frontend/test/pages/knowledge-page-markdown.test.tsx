import { describe, expect, test } from 'bun:test';
import { knowledgeHeadingId } from '../../src/components/pages/knowledge-page-markdown';

describe('knowledge page heading anchors', () => {
  test('derives readable anchors for linked page sections', () => {
    expect(knowledgeHeadingId('The Feedback Loop')).toBe('the-feedback-loop');
    expect(knowledgeHeadingId('Evidence, action & learning')).toBe('evidence-action-learning');
    expect(knowledgeHeadingId(['The ', <em key="feedback">Feedback</em>, ' Loop'])).toBe(
      'the-feedback-loop',
    );
  });
});
