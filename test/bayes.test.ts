import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { adLogOdds, adProbability, DEFAULT_AD_BAYES, type AdHit } from '../src/ad/bayes'

/** Build a hit list from shorthand: `s` = strong, `w` = weak, `[w, 5]` = count. */
const hits = (...specs: (['s' | 'w'] | ['s' | 'w', number] | ['s' | 'w', number, number])[]): AdHit[] =>
  specs.map(([kind, count = 1, lr]) => ({
    strong: kind === 's',
    count,
    ...(lr !== undefined ? { lr } : {}),
  }))

describe('adLogOdds / adProbability', () => {
  it('a generic pair of hits stays below the flag threshold', () => {
    const p = adProbability(adLogOdds(hits(['w'], ['w']), DEFAULT_AD_BAYES))
    assert.ok(p < DEFAULT_AD_BAYES.threshold)
    assert.ok(p < 0.2)
  })

  it('even many generic hits do not clear the threshold (diminishing returns)', () => {
    const p = adProbability(adLogOdds(hits(['w'], ['w'], ['w'], ['w'], ['w'], ['w'], ['w']), DEFAULT_AD_BAYES))
    assert.ok(p < DEFAULT_AD_BAYES.threshold)
  })

  it('a strong hit plus one generic hit clears the threshold at chat length', () => {
    const p = adProbability(adLogOdds(hits(['s'], ['w']), DEFAULT_AD_BAYES, DEFAULT_AD_BAYES.chatLength))
    assert.ok(p >= DEFAULT_AD_BAYES.threshold)
  })

  it('a lone strong hit stays below the threshold', () => {
    const p = adProbability(adLogOdds(hits(['s']), DEFAULT_AD_BAYES, DEFAULT_AD_BAYES.chatLength))
    assert.ok(p < DEFAULT_AD_BAYES.threshold)
  })

  it('two strong hits are a near-certain ad', () => {
    const p = adProbability(adLogOdds(hits(['s'], ['s']), DEFAULT_AD_BAYES))
    assert.ok(p > 0.9)
  })

  it('probability is monotonic in evidence', () => {
    const none = adProbability(adLogOdds([], DEFAULT_AD_BAYES))
    const oneWeak = adProbability(adLogOdds(hits(['w']), DEFAULT_AD_BAYES))
    const strongWeak = adProbability(adLogOdds(hits(['s'], ['w']), DEFAULT_AD_BAYES))
    assert.ok(none < oneWeak && oneWeak < strongWeak)
  })

  it('prior and threshold are honored', () => {
    const p = adProbability(adLogOdds(hits(['s'], ['w']), { ...DEFAULT_AD_BAYES, threshold: 0.1 }))
    assert.ok(p >= 0.1)
    assert.ok(p < 0.9)
  })

  it('a single keyword repeated many times is discounted (attention-seeking, not an ad)', () => {
    const once = adProbability(adLogOdds(hits(['w']), DEFAULT_AD_BAYES, 30))
    const thrice = adProbability(adLogOdds(hits(['w', 3]), DEFAULT_AD_BAYES, 30))
    const twenty = adProbability(adLogOdds(hits(['w', 20]), DEFAULT_AD_BAYES, 30))
    assert.ok(thrice < once)
    assert.ok(twenty < thrice)
    assert.ok(twenty < 0.05)
  })

  it('repeated strong keywords are discounted too', () => {
    const once = adProbability(adLogOdds(hits(['s']), DEFAULT_AD_BAYES, 30))
    const repeated = adProbability(adLogOdds(hits(['s', 10]), DEFAULT_AD_BAYES, 30))
    assert.ok(repeated < once)
  })

  it('a per-keyword LR override beats the class default', () => {
    const generic = adProbability(adLogOdds(hits(['s']), DEFAULT_AD_BAYES))
    const overridden = adProbability(adLogOdds(hits(['s', 1, 200]), DEFAULT_AD_BAYES))
    assert.ok(overridden > generic)
  })

  it('length evidence grows with length (beyond the chat habit)', () => {
    const short = adProbability(adLogOdds(hits(['w']), DEFAULT_AD_BAYES, DEFAULT_AD_BAYES.chatLength / 2))
    const chat = adProbability(adLogOdds(hits(['w']), DEFAULT_AD_BAYES, DEFAULT_AD_BAYES.chatLength))
    const long = adProbability(adLogOdds(hits(['w']), DEFAULT_AD_BAYES, DEFAULT_AD_BAYES.chatLength * 10))
    assert.ok(short < chat && chat < long)
  })

  it('a long message with one strong hit stays below the threshold (no single metric decides)', () => {
    // A lone strong keyword even at extreme length must not clear on its own:
    // the length term is capped precisely so it can only tip, never decide.
    const p = adProbability(adLogOdds(hits(['s']), DEFAULT_AD_BAYES, 10_000))
    assert.ok(p < DEFAULT_AD_BAYES.threshold)
    // Adding a second (generic) hit is what crosses the line.
    const pair = adProbability(adLogOdds(hits(['s'], ['w']), DEFAULT_AD_BAYES, 10_000))
    assert.ok(pair >= DEFAULT_AD_BAYES.threshold)
  })

  it('a suspicious URL adds ad evidence', () => {
    const withUrl = adLogOdds(hits(['w']), DEFAULT_AD_BAYES, 10, true)
    const without = adLogOdds(hits(['w']), DEFAULT_AD_BAYES, 10, false)
    assert.ok(withUrl > without)
  })

  it('a lone suspicious URL stays below the threshold (sharing a link is not an ad)', () => {
    const p = adProbability(adLogOdds([], DEFAULT_AD_BAYES, 20, true))
    assert.ok(p < DEFAULT_AD_BAYES.threshold)
    assert.ok(p < 0.2)
  })

  it('a suspicious URL plus a strong+generic pair is a near-certain ad', () => {
    const p = adProbability(adLogOdds(hits(['s'], ['w']), DEFAULT_AD_BAYES, 20, true))
    assert.ok(p > 0.9)
  })

  it('a spam-prone TLD adds a little extra doubt on top of a suspicious URL', () => {
    const plain = adProbability(adLogOdds(hits(['w']), DEFAULT_AD_BAYES, 20, true, false))
    const tld = adProbability(adLogOdds(hits(['w']), DEFAULT_AD_BAYES, 20, true, true))
    assert.ok(tld > plain)
    // Small by itself: still far below the threshold with weak evidence only.
    assert.ok(tld < DEFAULT_AD_BAYES.threshold)
  })

  it('a short message dampens keyword evidence smoothly up to chatLength', () => {
    const tiny = adProbability(adLogOdds(hits(['s'], ['w']), DEFAULT_AD_BAYES, 2))
    const short = adProbability(adLogOdds(hits(['s'], ['w']), DEFAULT_AD_BAYES, DEFAULT_AD_BAYES.chatLength / 2))
    const chat = adProbability(adLogOdds(hits(['s'], ['w']), DEFAULT_AD_BAYES, DEFAULT_AD_BAYES.chatLength))
    assert.ok(tiny < short && short < chat)
  })

  it('a short one-liner with a strong+generic pair stays below the threshold', () => {
    const p = adProbability(adLogOdds(hits(['s'], ['w']), DEFAULT_AD_BAYES, 5))
    assert.ok(p < DEFAULT_AD_BAYES.threshold)
  })
})