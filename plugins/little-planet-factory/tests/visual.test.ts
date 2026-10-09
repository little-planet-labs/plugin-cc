// v1.1 visuals: the band above the prompt, gauges, Agent rows, the spinner
// summary, toasts and the band's hotkey.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { COLOR, gauge, levelColor, rowsOf, rowText, rowWidth, textWidth, truncate } from '../hooks/mod/style'
import type { View } from '../hooks/mod/view'
import { agentRow, bandLayout, BUTTON_COLUMNS, COLLAPSE_COLUMNS, MAX_ROW_COLUMNS } from '../hooks/mod/view'
import { DIR, finish, measure, OPUS, OVERSEER, paneTexts, PLUGIN, spawn, start, world } from './world'

const bandProps = (bodyColumns: number, maxRows: number) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows,
  bodyColumns,
  scroll: { offset: 0, bodyRows: Math.max(1, maxRows - 1) },
  view: {},
})

async function mountBand($: Engine, bodyColumns: number, maxRows: number, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(bodyColumns, maxRows) })
}

type Mounted = Awaited<ReturnType<typeof mountBand>>

const bandRows = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Box' })).filter(found => found.key?.startsWith('band-')).map(found => found.text)

const isFramed = async (ui: Mounted) => (await ui.findAll({ type: 'Box' })).some(found => found.props.borderStyle !== undefined)

// Other mods' drawing of a site, standing beneath this plugin.
const OTHER = 'other mod row'

// The engine draws nothing of its own in the band: core's own drawing.
const emptyBand = (on: On) => on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)

// Another mod's band rows beneath this plugin, `rows` Texts in a column.
const otherRows = (on: On, rows: number) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ flexDirection: 'column', children: Array.from({ length: rows }, (_, index) => Text({ children: `${OTHER} ${index}` })) })
  })

const VIEW: View = {
  roster: [
    { id: 'a', type: 'little-planet-factory:inspector', description: 'auth', status: 'running' },
    { id: 'b', type: 'little-planet-factory:worker', description: 'auth', status: 'running' },
    { id: 'c', type: 'little-planet-factory:researcher', description: 'api', status: 'done' },
    { id: 'd', type: 'little-planet-factory:worker', description: 'docs', status: 'failed' },
  ],
  usage: {
    context: { tokens: 104_000, window: 200_000, percent: 52 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 41, resetsAt: new Date(7_800_000).toISOString() },
      { kind: 'seven_day', percentUsed: 85 },
    ],
  },
  ledgers: {
    main: { status: 'active', next: 're-inspect auth unit after repair', questions: ['Which base?'], units: {}, background: [] },
    managers: [],
  },
  now: 0,
}

describe('V1 band_inert_outside_overseer', () => {
  test('outside an overseer session the band is exactly what lies beneath', async ($, on) => {
    world(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: OTHER }))
    await start($, 'startup', 'general-purpose')
    const ui = await mountBand($, 80, 10)
    expect(await ui.drawn()).toEqual({ type: 'Text', children: [OTHER] })
  })

  test('in an overseer session the band keeps the other mods’ drawing under its own', async ($, on) => {
    world(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: OTHER }))
    await start($, 'startup', OVERSEER)
    const ui = await mountBand($, 80, 10)
    expect((await bandRows(ui)).length).toBeGreaterThan(0)
    expect(await ui.find({ type: 'Text', text: OTHER })).toBeDefined()
  })

  test('a survey holds the band: only what lies beneath is drawn', async ($, on) => {
    world(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: OTHER }))
    await start($, 'startup', OVERSEER)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...bandProps(80, 10), hasSurvey: true } })
    expect(await ui.drawn()).toEqual({ type: 'Text', children: [OTHER] })
  })
})

describe('V2 band_fits', () => {
  const sizes: [number, number][] = [
    [20, 10],
    [60, 10],
    [140, 10],
    [60, 2],
    [60, 1],
    [140, 3],
  ]
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`no row is wider than the band or taller than maxRows on ${surface}`, async ($, on) => {
      const w = world(on)
      emptyBand(on)
      w.agents = VIEW.roster.map(({ id, type, description, status }) => ({
        id,
        type: type!,
        description: description!,
        status: status === 'done' ? 'completed' : status,
      }))
      await start($, 'startup', OVERSEER)
      await measure($, { tokens: 104_000, window: 200_000, percent: 52 }, { rateLimits: VIEW.usage.rateLimits })
      for (const [columns, maxRows] of sizes) {
        const ui = await mountBand($, columns, maxRows, surface)
        const rows = await bandRows(ui)
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.length + ((await isFramed(ui)) ? 2 : 0)).toBeLessThanOrEqual(maxRows)
        for (const row of rows) expect([...row].length).toBeLessThanOrEqual(columns - COLLAPSE_COLUMNS)
        // Below 26 columns not even `◉ ctx 52%` fits beside the Button, so it goes.
        expect((await ui.find({ key: 'open-factory' })) !== undefined).toBe(columns >= 26)
        await ui.unmount()
      }
    })
  }

  test('other mods’ rows come out of the budget: the whole band stays within maxRows', async ($, on) => {
    const w = world(on)
    otherRows(on, 2)
    // Enough to fill three rows on its own: gauges, chips and the next step.
    w.agents = [{ id: 'a', description: 'auth', type: 'little-planet-factory:worker', status: 'running' }]
    await start($, 'startup', OVERSEER)
    await measure($, { tokens: 104_000, window: 200_000, percent: 52 })
    const ui = await mountBand($, 100, 3)
    const ours = (await bandRows(ui)).length + ((await isFramed(ui)) ? 2 : 0)
    expect(ours).toBe(1)
    expect(await ui.findAll({ type: 'Text', text: OTHER })).toHaveLength(2)
  })

  test('when other mods fill the band, it is exactly their drawing', async ($, on) => {
    world(on)
    otherRows(on, 3)
    await start($, 'startup', OVERSEER)
    const ui = await mountBand($, 100, 3)
    expect(await bandRows(ui)).toEqual([])
    expect(await ui.findAll({ type: 'Text', text: OTHER })).toHaveLength(3)
  })

  test('the Button goes when it doesn’t fit, and a band with no room draws nothing of ours', async ($, on) => {
    world(on)
    emptyBand(on)
    await start($, 'startup', OVERSEER)
    let ui = await mountBand($, 15, 10)
    expect((await bandRows(ui)).length).toBe(1)
    expect(await ui.find({ key: 'open-factory' })).toBeUndefined()
    await ui.unmount()
    ui = await mountBand($, 5, 10)
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    await ui.unmount()
    ui = await mountBand($, 0, 10)
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
  })

  test('with nothing to show the band is one line with the title, never empty', async ($, on) => {
    const w = world(on)
    emptyBand(on)
    w.files[`${DIR}/factory-ledger.md`] = '# Factory ledger\nStatus: active\n'
    await start($, 'startup', OVERSEER)
    const ui = await mountBand($, 60, 3)
    expect(await bandRows(ui)).toEqual(['◉ Little Planet Factory/factory'])
    expect(await ui.find({ key: 'open-factory' })).toBeDefined()
  })

  test('wide characters count two cells', () => {
    const wide: View = {
      ...VIEW,
      roster: VIEW.roster.map(entry => ({ ...entry, description: '認証モジュール修理' })),
      ledgers: { ...VIEW.ledgers, main: { ...VIEW.ledgers.main!, next: '認証ユニットを再検査する🔍🔍🔍🔍🔍🔍🔍🔍🔍🔍' } },
    }
    for (const [columns, maxRows] of sizes) {
      const { isFramed, rows, hasButton } = bandLayout(wide, columns, maxRows)
      const width = columns - COLLAPSE_COLUMNS - (isFramed ? 4 : 0)
      rows.forEach((row, index) =>
        expect(rowWidth(row) + (index === rows.length - 1 && hasButton ? BUTTON_COLUMNS : 0)).toBeLessThanOrEqual(width),
      )
    }
    expect(textWidth('日本語')).toBe(6)
    expect(textWidth('✅⭐❌🪄🀄')).toBe(10)
    expect(textWidth('●✓✗◉▸↻')).toBe(6)
    expect(truncate('日本語テキスト', 7)).toBe('日本語…')
  })

  test('narrow bands never cut a figure: whole figures or none', () => {
    const figures = ['ctx 52%', '5h 41%', '2 running']
    for (let columns = 12; columns <= 40; columns += 1) {
      for (const maxRows of [1, 2, 3]) {
        for (const row of bandLayout(VIEW, columns, maxRows).rows.map(rowText)) {
          expect(row).not.toMatch(/\d…/)
          for (const piece of row.split(/ · |   /)) {
            const figure = /(ctx|5h|7d) \S*$/.exec(piece)?.[0]
            if (figure !== undefined && !piece.includes('█') && !piece.includes('░')) expect(figures).toContain(figure)
          }
        }
      }
    }
  })

  test('a narrow one-line band drops the Button before a figure, then keeps only the glyph', () => {
    expect(bandLayout(VIEW, 26, 1)).toMatchObject({ hasButton: true })
    expect(rowText(bandLayout(VIEW, 26, 1).rows[0]!)).toBe('◉ ctx 52%')
    const noButton = bandLayout(VIEW, 17, 1)
    expect(noButton.hasButton).toBe(false)
    expect(rowText(noButton.rows[0]!)).toBe('◉ ctx 52%')
    expect(rowText(bandLayout(VIEW, 30, 1).rows[0]!)).toBe('◉ ctx 52%')
    // 9 cells of room fit `◉ ctx 52%` exactly; 8 leave only the glyph.
    expect(rowText(bandLayout(VIEW, 14, 1).rows[0]!)).toBe('◉ ctx 52%')
    expect(rowText(bandLayout(VIEW, 13, 1).rows[0]!)).toBe('◉')
  })

  test('rows leave room for the collapse control and the Button', () => {
    for (const [columns, maxRows] of sizes) {
      const { isFramed, rows } = bandLayout(VIEW, columns, maxRows)
      const width = columns - COLLAPSE_COLUMNS - (isFramed ? 4 : 0)
      const { hasButton } = bandLayout(VIEW, columns, maxRows)
      rows.forEach((row, index) =>
        expect(rowWidth(row) + (index === rows.length - 1 && hasButton ? BUTTON_COLUMNS : 0)).toBeLessThanOrEqual(width),
      )
      expect(rows.length + (isFramed ? 2 : 0)).toBeLessThanOrEqual(maxRows)
    }
  })

  test('narrowing drops the 7d gauge, then the chips, then goes to one line', () => {
    const text = (columns: number, maxRows: number) => bandLayout(VIEW, columns, maxRows).rows.map(rowText)
    const wide = text(140, 10)
    expect(wide.join('\n')).toContain('7d ')
    expect(wide.join('\n')).toContain('● inspector·auth')
    expect(wide[0]).toContain('Little Planet Factory')
    const medium = text(60, 10)
    expect(medium.join('\n')).not.toContain('7d ')
    expect(medium.join('\n')).toContain('↻')
    expect(medium.join('\n')).toContain('● inspector')
    const short = text(60, 2)
    expect(short.join('\n')).not.toContain('●')
    expect(short).toHaveLength(2)
    expect(text(20, 10)).toHaveLength(1)
    expect(text(60, 1)).toHaveLength(1)
  })

  test('chips list running agents first and fold the rest into +N', () => {
    const chips = bandLayout(VIEW, 140, 10).rows.map(rowText).find(row => row.includes('●'))!
    expect(chips.indexOf('● inspector')).toBeLessThan(chips.indexOf('✗ worker'))
    expect(chips.indexOf('✗ worker')).toBeLessThan(chips.indexOf('✓ researcher'))
    const narrow = bandLayout(VIEW, 48, 4).rows.map(rowText).find(row => row.includes('●'))!
    expect(narrow).toMatch(/\+\d+$/)
  })
})

describe('V2 rowsOf estimates other mods’ rows', () => {
  const text = (...children: unknown[]) => ({ type: 'Text', props: {}, children })
  const box = (props: Record<string, unknown>, ...children: unknown[]) => ({ type: 'Box', props, children })
  const cases: [string, unknown, number, number][] = [
    ['core’s own drawing', { type: 'engine', ref: 0 }, 80, 0],
    ['a bare string with a newline', 'a\nb', 80, 2],
    ['newlines across a Text’s strings, nested Text included', text('a\nb', text('c\nd')), 80, 3],
    ['a long Text wraps', text('x'.repeat(100)), 40, 3],
    ['a truncating Text does not wrap', { type: 'Text', props: { wrap: 'truncate-end' }, children: ['x'.repeat(100)] }, 40, 1],
    ['wide characters wrap at half the count', text('日本語'.repeat(10)), 40, 2],
    ['a Markdown block counts its lines', { type: 'Markdown', props: { text: 'a\nb\nc' }, children: [] }, 80, 3],
    ['a Button is one row', { type: 'Button', props: { label: 'x' }, children: [] }, 80, 1],
    ['a row Box takes its tallest child', box({}, text('a'), box({ flexDirection: 'column' }, text('b'), text('c'))), 80, 2],
    ['nested column Boxes add up', box({ flexDirection: 'column' }, text('a'), box({ flexDirection: 'column' }, text('b'), text('c'))), 80, 3],
    ['a column gap adds between children', box({ flexDirection: 'column', gap: 1 }, text('a'), text('b'), text('c')), 80, 5],
    ['rowGap too', box({ flexDirection: 'column', rowGap: 2 }, text('a'), text('b'), text('c')), 80, 7],
    ['a border and paddingY add rows', box({ flexDirection: 'column', borderStyle: 'round', paddingY: 1 }, text('a'), text('b')), 80, 6],
    ['a border and paddingX narrow what wraps', box({ borderStyle: 'round', paddingX: 1 }, text('x'.repeat(8))), 10, 4],
    ['minHeight is a floor', box({ flexDirection: 'column', minHeight: 4 }, text('a')), 80, 4],
    ['height is exact', box({ flexDirection: 'column', height: 2 }, text('a'), text('b'), text('c'), text('d')), 80, 2],
    ['display none takes nothing', box({ display: 'none' }, text('a')), 80, 0],
    ['a Box’s own width narrows what wraps', box({ width: 20 }, text('x'.repeat(80))), 80, 4],
    ['its own width less border and padding', box({ width: 20, borderStyle: 'round', paddingX: 1 }, text('x'.repeat(32))), 80, 4],
  ]
  for (const [name, node, columns, rows] of cases) {
    test(name, () => expect(rowsOf(node, columns)).toBe(rows))
  }
})

describe('V3 gauge_levels', () => {
  test('green under 60, yellow under 80, red from 80', () => {
    expect([0, 59, 60, 79, 80, 100].map(levelColor)).toEqual([COLOR.good, COLOR.good, COLOR.warn, COLOR.warn, COLOR.bad, COLOR.bad])
  })

  test('a gauge fills in proportion, clamps the bar and prints the rounded percent', () => {
    expect(gauge('ctx', 52, 8)).toEqual([
      { text: 'ctx ' },
      { text: '████', color: COLOR.good },
      { text: '░░░░', dim: true },
      { text: ' 52%', color: COLOR.good },
    ])
    expect(rowText(gauge('5h', 130, 4))).toBe('5h ████ 130%')
    expect(rowText(gauge('7d', 12.5, 0))).toBe('7d 13%')
  })

  test('unknown figures leave their gauges out, never NaN', async ($, on) => {
    const w = world(on)
    emptyBand(on)
    w.files = {}
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000 })
    const ui = await mountBand($, 140, 10)
    const text = (await bandRows(ui)).join('\n')
    expect(text).not.toMatch(/ctx|5h|7d|NaN|undefined/)
  })
})

describe('V4 agent_rows_pass_through', () => {
  const toolRow = (tool: string, toolUseId: string) => ({
    tool_use_id: toolUseId,
    tool,
    input: {},
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  })

  test('non-Agent rows, and Agent rows with nothing known, are the engine’s own', async ($, on) => {
    world(on)
    on('ui.render', { component: 'ToolUse' }, ($, e) => $.ui.resolve(e).Text({ children: `engine ${e.props.tool}` }))
    await start($, 'startup', OVERSEER)
    await spawn($, 'auth')
    for (const [tool, id] of [
      ['Bash', 'tu-auth'],
      ['Read', 'tu-x'],
      ['Agent', 'tu-unknown'],
    ] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', requestId: id, props: toolRow(tool, id) })
      expect(await ui.drawn()).toEqual({ type: 'Text', children: [`engine ${tool}`] })
      await ui.unmount()
    }
  })

  test('a known Agent row is a card; outside an overseer session it is the engine’s', async ($, on) => {
    const w = world(on)
    on('ui.render', { component: 'ToolUse' }, ($, e) => $.ui.resolve(e).Text({ children: `engine ${e.props.tool}` }))
    await start($, 'startup', OVERSEER)
    await spawn($, 'auth')
    const id = w.spawned[0]!
    let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', requestId: id, props: toolRow('Agent', id) })
    expect((await ui.find({ key: 'agent' }))?.text).toBe('● worker · auth · opus-4-5 · 0s')
    expect(await ui.find({ type: 'Text', text: 'engine Agent' })).toBeDefined()
    await ui.unmount()
    // Finished, the card still leaves tokens to the engine's row beneath it.
    await finish($, 'auth', 'answer', OPUS)
    ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', requestId: id, props: toolRow('Agent', id) })
    expect((await ui.find({ key: 'agent' }))?.text).toBe('✓ worker · auth · opus-4-5 · 0s')
    await ui.unmount()
    await start($, 'startup', 'general-purpose')
    ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', requestId: id, props: toolRow('Agent', id) })
    expect(await ui.drawn()).toEqual({ type: 'Text', children: ['engine Agent'] })
  })
})

describe('V4 agent card above the engine row', () => {
  test('the engine’s progress and error text stays under the card, card first', async ($, on) => {
    const w = world(on)
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return Box({
        flexDirection: 'column',
        children: [Text({ children: `Agent(${e.props.tool})` }), Text({ children: e.props.isErrored ? 'Error: agent crashed' : '⎿ Running 3 tools…' })],
      })
    })
    await start($, 'startup', OVERSEER)
    await spawn($, 'auth')
    const id = w.spawned[0]!
    for (const isErrored of [false, true]) {
      const props = { tool_use_id: id, tool: 'Agent', input: {}, isRunning: !isErrored, isErrored, isInterrupted: false }
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', requestId: id, props })
      const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
      const detail = isErrored ? 'Error: agent crashed' : '⎿ Running 3 tools…'
      expect(texts).toContain(detail)
      expect(texts.findIndex(text => text.startsWith('● worker'))).toBeLessThan(texts.indexOf(detail))
      await ui.unmount()
    }
  })
})

describe('fitRow keeps segments after a sanitized one', () => {
  test('a tab or newline in a description doesn’t drop the model and elapsed time', () => {
    const row = agentRow({ id: 'x', type: 'worker', description: 'auth\tmodule\nfix', model: 'claude-opus-4-5', startedAt: 0, status: 'running' }, 65_000)
    expect(rowText(row)).toBe('● worker · auth module fix · opus-4-5 · 1m')
  })
})

describe('V4 agent card text (pure)', () => {
  test('a description with control characters or great length stays one bounded line', () => {
    const row = agentRow({ id: 'x', type: 'worker', description: `line one\nline two\u0007${'z'.repeat(5000)}`, status: 'running' }, 0)
    expect(rowText(row)).not.toMatch(/[\u0000-\u001f]/)
    expect(rowWidth(row)).toBeLessThanOrEqual(MAX_ROW_COLUMNS)
  })
})

describe('V5 spinner_composes', () => {
  const SPIN = { word: 'Baking', message: null, suffix: '…', mode: 'responding' as const }

  async function spinnerText($: Engine) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPIN })
    const text = (await ui.find({ type: 'Text' }))?.text
    await ui.unmount()
    return text
  }

  test('the engine’s spinner stays, with the summary after it only while agents run', async ($, on) => {
    world(on)
    on('ui.render', { component: 'Spinner' }, ($, e) => $.ui.resolve(e).Text({ children: `${e.props.word}${e.props.suffix}` }))
    await start($, 'startup', OVERSEER)
    expect(await spinnerText($)).toBe('Baking…')
    await spawn($, 'auth')
    expect(await spinnerText($)).toBe('Baking… · 1 agent running · next: Inspect core once it reports.')
    await finish($, 'auth', 'answer')
    expect(await spinnerText($)).toBe('Baking…')
  })

  test('outside an overseer session the spinner is untouched', async ($, on) => {
    const w = world(on)
    w.agents = [{ id: 'x', description: 'x', type: 'worker', status: 'running' }]
    on('ui.render', { component: 'Spinner' }, ($, e) => $.ui.resolve(e).Text({ children: `${e.props.word}${e.props.suffix}` }))
    await start($, 'startup', 'general-purpose')
    expect(await spinnerText($)).toBe('Baking…')
  })
})

describe('V6 toasts_once', () => {
  test('one toast per agent that finishes or fails', async ($, on) => {
    const w = world(on)
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'auth')
    await spawn($, 'docs')
    await w.clock.advance(120_000)
    await finish($, 'auth', 'answer', OPUS)
    await finish($, 'docs', 'error')
    expect(w.toasts).toEqual(['✓ worker · auth done · 2m', '✗ worker · docs failed · 2m'])
  })

  test('none for agents finished before load or ids the mod never knew', async ($, on) => {
    const w = world(on)
    w.agents = [{ id: 'old', description: 'Earlier', type: 'little-planet-factory:researcher', status: 'completed' }]
    await start($, 'startup', OVERSEER)
    await finish($, 'compaction-fork', 'answer', OPUS)
    expect(w.toasts).toEqual([])
  })

  test('a limit toast once per crossing of 80%, re-armed below 70% or at a reset', async ($, on) => {
    const w = world(on)
    w.files = {}
    await start($, 'startup', OVERSEER)
    const at = (percentUsed: number, resetsAt = '2026-10-03T15:00:00.000Z') =>
      measure($, { window: 200_000 }, { rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }], changed: ['rateLimits'] })
    for (const percent of [79, 82, 85, 75, 72]) await at(percent)
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toMatch(/^5h limit at 82% · resets in /)
    await at(69)
    await at(81)
    expect(w.toasts).toHaveLength(2)
    await at(90, '2026-10-03T20:00:00.000Z')
    expect(w.toasts).toHaveLength(3)
    await measure($, { window: 200_000 }, { rateLimits: [{ kind: 'seven_day', percentUsed: 80 }], changed: ['rateLimits'] })
    expect(w.toasts[3]).toBe('7d limit at 80%')
  })

  test('/clear doesn’t re-arm a limit toast for the same window', async ($, on) => {
    const w = world(on)
    w.files = {}
    await start($, 'startup', OVERSEER)
    const reading = { rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-03T15:00:00.000Z' }], changed: ['rateLimits'] }
    await measure($, { window: 200_000 }, reading)
    await start($, 'clear', OVERSEER)
    await measure($, { window: 200_000 }, reading)
    expect(w.toasts).toHaveLength(1)
  })

  test('no toasts outside an overseer session', async ($, on) => {
    const w = world(on)
    await start($, 'startup', 'general-purpose')
    await spawn($, 'auth')
    await finish($, 'auth', 'answer', OPUS)
    await measure($, { window: 200_000 }, { rateLimits: [{ kind: 'five_hour', percentUsed: 95 }] })
    expect(w.toasts).toEqual([])
  })
})

describe('V7 band_hotkey_opens_pane', () => {
  test('the band’s 1 Button opens the /factory pane', async ($, on) => {
    const w = world(on)
    emptyBand(on)
    await start($, 'startup', OVERSEER)
    const ui = await mountBand($, 100, 10)
    const button = await ui.find({ key: 'open-factory' })
    expect(button?.props).toMatchObject({ hotkey: '1', label: '/factory' })
    await ui.press({ key: 'open-factory' })
    expect(w.opened).toEqual(['factory'])
  })
})

describe('V8 tokens_match_engine', () => {
  // Two requests by one agent: cache reads dominate, as in a real run.
  const STEP_1 = { model: 'claude-opus-4-5', input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 1_000 }
  const STEP_2 = { model: 'claude-opus-4-5', input_tokens: 120, output_tokens: 400, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 300 }
  // What the run's turn.complete reports: both requests summed.
  const SUMMED = { model: 'claude-opus-4-5', input_tokens: 220, output_tokens: 600, cache_read_input_tokens: 102_000, cache_creation_input_tokens: 1_300 }

  async function step($: Engine, agentId: string | undefined) {
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-4-5', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) } as never)
    for await (const _ of stream as AsyncIterable<unknown>) void _
  }

  const stepsBeneath = (on: On, usages: object[]) =>
    on('turn.step', async function* ($, e) {
      const usage = usages.shift() ?? null
      yield { kind: 'stop', stopReason: 'end_turn', usage } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
    })

  test('an agent’s tokens are its last request’s total, not the cache-inflated sum', async ($, on) => {
    const w = world(on)
    stepsBeneath(on, [STEP_1, STEP_2])
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'auth')
    await step($, 'auth')
    await step($, 'auth')
    await finish($, 'auth', 'answer', SUMMED as typeof OPUS)
    // 120 + 300 + 52,000 + 400 = 52,820; the sum of both would be 104.1k.
    expect(await paneTexts($, 100)).toContain('    ✓ worker · auth · opus-4-5 · 0s · 52.8k tok')
    expect(w.toasts).toEqual(['✓ worker · auth done · 0s · 52.8k tok'])
  })

  test('a completed foreground Agent result’s totalTokens wins', async ($, on) => {
    const w = world(on)
    stepsBeneath(on, [STEP_2])
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'auth')
    await step($, 'auth')
    await finish($, 'auth', 'answer', STEP_2)
    w.toolResult = { result: { status: 'completed', agentId: 'auth', totalTokens: 41_234, content: [] }, text: 'done' }
    await $.tool.call({ tool: 'Agent', description: 'auth', prompt: 'p' } as never)
    expect(await paneTexts($, 100)).toContain('    ✓ worker · auth · opus-4-5 · 0s · 41.2k tok')
    // The poll's fold doesn't put an older step figure back over it.
    await w.clock.advance(15_000)
    expect(await paneTexts($, 100)).toContain('    ✓ worker · auth · opus-4-5 · 0s · 41.2k tok')
  })

  test('the step’s result isn’t held up by the mod’s bookkeeping', async ($, on) => {
    const w = world(on)
    stepsBeneath(on, [STEP_2])
    // Writes of the step figures take a minute of (mocked) time to land.
    on('state.set', async ($, e, next) => {
      if (e.key === 'stepTokens') await w.clock.sleep(60_000)
      return next(e)
    })
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'auth')
    let isDone = false
    void step($, 'auth').then(() => (isDone = true))
    await w.clock.settle()
    expect(isDone).toBe(true)
    await w.clock.advance(60_000)
  })

  test('a step alone redraws nothing: the poll or turn.complete folds it in', async ($, on) => {
    const w = world(on)
    stepsBeneath(on, [STEP_2, STEP_1])
    const writes: string[] = []
    on('state.set', ($, e, next) => (writes.push(e.key), next(e)))
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'auth')
    writes.length = 0
    await step($, 'auth')
    await w.clock.settle()
    expect(writes).toEqual(['stepTokens'])
    expect(await paneTexts($, 100)).toContain('    ● worker · auth · opus-4-5 · 0s')
    await w.clock.advance(15_000)
    expect(writes).toContain('details')
    expect(await paneTexts($, 100)).toContain('    ● worker · auth · opus-4-5 · 15s · 52.8k tok')
    // A later step reaches the details at turn.complete, without waiting for the poll.
    await step($, 'auth')
    await w.clock.settle()
    await finish($, 'auth', 'answer', STEP_1)
    expect(await paneTexts($, 100)).toContain('    ✓ worker · auth · opus-4-5 · 15s · 51.3k tok')
  })

  test('main-loop steps and agents the mod never knew record nothing', async ($, on) => {
    const w = world(on)
    stepsBeneath(on, [STEP_1, STEP_2])
    w.agents = null
    await start($, 'startup', OVERSEER)
    await step($, undefined)
    await step($, 'compaction-fork')
    const texts = await paneTexts($, 100)
    expect(texts.slice(texts.indexOf('Agents') + 2, texts.indexOf('Ledger'))).toEqual([])
  })
})

describe('V9 chips_distinguishable', () => {
  const inspectors: View = {
    ...VIEW,
    roster: [
      { id: 'i1', type: 'little-planet-factory:inspector', description: 'Inspect test-coverage', status: 'failed' },
      { id: 'i2', type: 'little-planet-factory:inspector', description: 'Inspect test-fixtures', status: 'done' },
      { id: 'w1', type: 'little-planet-factory:worker', description: 'docs pass', status: 'done' },
      { id: 'w2', type: 'little-planet-factory:worker', description: 'docs pass', status: 'done' },
    ],
  }
  const chips = (columns: number, maxRows: number) =>
    bandLayout(inspectors, columns, maxRows).rows.map(rowText).find(row => row.includes('inspector'))!

  test('descriptions share the room: with enough of it, each shows whole', () => {
    expect(chips(100, 10)).toBe('✗ inspector·Inspect test-coverage  ✓ inspector·Inspect test-fixtures  ✓ worker·docs pass ×2')
  })

  test('cut descriptions keep both ends, so a shared prefix still differs', () => {
    const row = chips(60, 4)
    const labels = row.split('  ').filter(part => part.includes('inspector'))
    expect(labels).toHaveLength(2)
    expect(labels[0]).not.toBe(labels[1]!.replace('✓', '✗'))
    // The distinct ends survive the cut.
    expect(labels[0]).toMatch(/…\w*erage$/)
    expect(labels[1]).toMatch(/…\w*tures$/)
  })

  test('with many agents, fewer chips show rather than descriptions cut to a few letters', () => {
    const many: View = {
      ...VIEW,
      roster: Array.from({ length: 8 }, (_, index) => ({
        id: `a${index}`,
        type: 'little-planet-factory:worker',
        description: `long unit description ${index}`,
        status: 'running' as const,
      })),
    }
    for (const columns of [60, 80, 100, 140]) {
      const row = bandLayout(many, columns, 10).rows.map(rowText).find(text => text.includes('worker'))!
      const descriptions = row.split('  ').filter(part => part.includes('·')).map(part => part.split('·')[1]!)
      expect(descriptions.length).toBeGreaterThan(0)
      for (const description of descriptions) expect(textWidth(description)).toBeGreaterThanOrEqual(12)
      expect(row).toMatch(/\+\d+$/)
    }
  })

  test('identical type, description and status share one chip with ×N', () => {
    expect(chips(100, 10)).toContain('✓ worker·docs pass ×2')
    expect(chips(100, 10).match(/docs pass/g)).toHaveLength(1)
  })

  test('the chips stay within the band at every width, +N counting agents', () => {
    for (let columns = 30; columns <= 140; columns += 5) {
      for (const maxRows of [3, 10]) {
        const { isFramed, rows } = bandLayout(inspectors, columns, maxRows)
        const width = columns - COLLAPSE_COLUMNS - (isFramed ? 4 : 0)
        for (const row of rows) expect(rowWidth(row)).toBeLessThanOrEqual(width)
      }
    }
    expect(chips(48, 4)).toMatch(/\+[23]$/)
  })
})
