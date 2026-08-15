import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { violationLogOdds, violationProbability, DEFAULT_MODERATION_BAYES, type ModerationHit } from '../src/moderation/bayes'

/** Build a hit list from shorthand: `s` = strong, `w` = weak, `[w, 5]` = count. */
const hits = (...specs: (['s' | 'w'] | ['s' | 'w', number] | ['s' | 'w', number, number])[]): ModerationHit[] =>
  specs.map(([kind, count = 1, lr]) => ({
    strong: kind === 's',
    count,
    ...(lr !== undefined ? { lr } : {}),
  }))

describe('violationLogOdds / violationProbability', () => {
  it('a generic pair of hits stays below the flag threshold', () => {
    const p = violationProbability(violationLogOdds(hits(['w'], ['w']), DEFAULT_MODERATION_BAYES))
    assert.ok(p < DEFAULT_MODERATION_BAYES.threshold)
    assert.ok(p < 0.2)
  })

  it('even many generic hits do not clear the threshold (diminishing returns)', () => {
    const p = violationProbability(violationLogOdds(hits(['w'], ['w'], ['w'], ['w'], ['w'], ['w'], ['w']), DEFAULT_MODERATION_BAYES))
    assert.ok(p < DEFAULT_MODERATION_BAYES.threshold)
  })

  it('a strong hit plus one generic hit clears the threshold at chat length', () => {
    const p = violationProbability(violationLogOdds(hits(['s'], ['w']), DEFAULT_MODERATION_BAYES, DEFAULT_MODERATION_BAYES.chatLength))
    assert.ok(p >= DEFAULT_MODERATION_BAYES.threshold)
  })

  it('a lone strong hit stays below the threshold', () => {
    const p = violationProbability(violationLogOdds(hits(['s']), DEFAULT_MODERATION_BAYES, DEFAULT_MODERATION_BAYES.chatLength))
    assert.ok(p < DEFAULT_MODERATION_BAYES.threshold)
  })

  it('two strong hits are a near-certain ad', () => {
    const p = violationProbability(violationLogOdds(hits(['s'], ['s']), DEFAULT_MODERATION_BAYES))
    assert.ok(p > 0.9)
  })

  it('probability is monotonic in evidence', () => {
    const none = violationProbability(violationLogOdds([], DEFAULT_MODERATION_BAYES))
    const oneWeak = violationProbability(violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES))
    const strongWeak = violationProbability(violationLogOdds(hits(['s'], ['w']), DEFAULT_MODERATION_BAYES))
    assert.ok(none < oneWeak && oneWeak < strongWeak)
  })

  it('prior and threshold are honored', () => {
    const p = violationProbability(violationLogOdds(hits(['s'], ['w']), { ...DEFAULT_MODERATION_BAYES, threshold: 0.1 }))
    assert.ok(p >= 0.1)
    assert.ok(p < 0.9)
  })

  it('a single keyword repeated many times is discounted (attention-seeking, not an ad)', () => {
    const once = violationProbability(violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, 30))
    const thrice = violationProbability(violationLogOdds(hits(['w', 3]), DEFAULT_MODERATION_BAYES, 30))
    const twenty = violationProbability(violationLogOdds(hits(['w', 20]), DEFAULT_MODERATION_BAYES, 30))
    assert.ok(thrice < once)
    assert.ok(twenty < thrice)
    assert.ok(twenty < 0.05)
  })

  it('repeated strong keywords are discounted too', () => {
    const once = violationProbability(violationLogOdds(hits(['s']), DEFAULT_MODERATION_BAYES, 30))
    const repeated = violationProbability(violationLogOdds(hits(['s', 10]), DEFAULT_MODERATION_BAYES, 30))
    assert.ok(repeated < once)
  })

  it('a per-keyword LR override beats the class default', () => {
    const generic = violationProbability(violationLogOdds(hits(['s']), DEFAULT_MODERATION_BAYES))
    const overridden = violationProbability(violationLogOdds(hits(['s', 1, 200]), DEFAULT_MODERATION_BAYES))
    assert.ok(overridden > generic)
  })

  it('length evidence grows with length (beyond the chat habit)', () => {
    const short = violationProbability(violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, DEFAULT_MODERATION_BAYES.chatLength / 2))
    const chat = violationProbability(violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, DEFAULT_MODERATION_BAYES.chatLength))
    const long = violationProbability(violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, DEFAULT_MODERATION_BAYES.chatLength * 10))
    assert.ok(short < chat && chat < long)
  })

  it('a long message with one strong hit stays below the threshold (no single metric decides)', () => {
    // A lone strong keyword even at extreme length must not clear on its own:
    // the length term is capped precisely so it can only tip, never decide.
    const p = violationProbability(violationLogOdds(hits(['s']), DEFAULT_MODERATION_BAYES, 10_000))
    assert.ok(p < DEFAULT_MODERATION_BAYES.threshold)
    // Adding a second (generic) hit is what crosses the line.
    const pair = violationProbability(violationLogOdds(hits(['s'], ['w']), DEFAULT_MODERATION_BAYES, 10_000))
    assert.ok(pair >= DEFAULT_MODERATION_BAYES.threshold)
  })

  it('a suspicious URL adds ad evidence', () => {
    const withUrl = violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, 10, true)
    const without = violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, 10, false)
    assert.ok(withUrl > without)
  })

  it('a lone suspicious URL stays below the threshold (sharing a link is not an ad)', () => {
    const p = violationProbability(violationLogOdds([], DEFAULT_MODERATION_BAYES, 20, true))
    assert.ok(p < DEFAULT_MODERATION_BAYES.threshold)
    assert.ok(p < 0.2)
  })

  it('a suspicious URL plus a strong+generic pair is a near-certain ad', () => {
    const p = violationProbability(violationLogOdds(hits(['s'], ['w']), DEFAULT_MODERATION_BAYES, 20, true))
    assert.ok(p > 0.9)
  })

  it('a spam-prone TLD adds a little extra doubt on top of a suspicious URL', () => {
    const plain = violationProbability(violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, 20, true, false))
    const tld = violationProbability(violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, 20, true, true))
    assert.ok(tld > plain)
    // Small by itself: still far below the threshold with weak evidence only.
    assert.ok(tld < DEFAULT_MODERATION_BAYES.threshold)
  })

  it('a short message dampens keyword evidence smoothly up to chatLength', () => {
    const tiny = violationProbability(violationLogOdds(hits(['s'], ['w']), DEFAULT_MODERATION_BAYES, 2))
    const short = violationProbability(violationLogOdds(hits(['s'], ['w']), DEFAULT_MODERATION_BAYES, DEFAULT_MODERATION_BAYES.chatLength / 2))
    const chat = violationProbability(violationLogOdds(hits(['s'], ['w']), DEFAULT_MODERATION_BAYES, DEFAULT_MODERATION_BAYES.chatLength))
    assert.ok(tiny < short && short < chat)
  })

  it('a short one-liner with a strong+generic pair stays below the threshold', () => {
    const p = violationProbability(violationLogOdds(hits(['s'], ['w']), DEFAULT_MODERATION_BAYES, 5))
    assert.ok(p < DEFAULT_MODERATION_BAYES.threshold)
  })

  it('a variant hit is weighed by variantLr on top of its class LR', () => {
    const weak = violationProbability(violationLogOdds(hits(['w']), DEFAULT_MODERATION_BAYES, 30))
    const variant = violationProbability(violationLogOdds([{ strong: false, count: 1, variant: true }], DEFAULT_MODERATION_BAYES, 30))
    assert.ok(variant > weak, 'a weak variant must outscore the same weak keyword')
    const strong = violationProbability(violationLogOdds(hits(['s']), DEFAULT_MODERATION_BAYES, 30))
    const strongVariant = violationProbability(violationLogOdds([{ strong: true, count: 1, variant: true }], DEFAULT_MODERATION_BAYES, 30))
    assert.ok(strongVariant > strong, 'a strong variant must outscore the same strong keyword')
  })
})