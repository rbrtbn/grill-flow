import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Message } from './main'
import { RETIRING, RETIRING_SUMMARY, type Verdict } from './retirement'

type H = HtmlBuilder<Message>

const VERDICT_TONES: Readonly<Record<Verdict, string>> = {
  'Already in': 'done',
  'Move to': 'move',
  Keep: 'keep',
  Drop: 'drop',
}

/** The end of Squad overview: each retiring page, part by part, with where it goes. */
export const retirementView = (h: H): Html =>
  h.section(
    [h.Class('f-retiring'), h.AriaLabel('Retiring: where each part goes')],
    [
      h.h2([], ['Retiring: where each part goes']),
      h.p([h.Class('f-retiring-summary')], [RETIRING_SUMMARY]),
      h.p(
        [h.Class('f-retiring-key')],
        [
          'Already in: the new design shows it. Move to: it needs a small change there. Keep: it stays. Drop: not needed. These are recommendations; say which to change.',
        ],
      ),
      ...RETIRING.map(page =>
        h.section(
          [h.Class('f-retiring-page')],
          [
            h.h3(
              [],
              [
                page.page,
                page.usage === undefined ? h.empty : h.small([], [page.usage]),
              ],
            ),
            h.table(
              [h.Class('f-retiring-table')],
              [
                h.thead(
                  [],
                  [
                    h.tr(
                      [],
                      ['Part', 'Recommendation', 'Where', 'Why'].map(label =>
                        h.th([h.Scope('col')], [label]),
                      ),
                    ),
                  ],
                ),
                h.tbody(
                  [],
                  page.parts.map(part =>
                    h.tr(
                      [],
                      [
                        h.th(
                          [h.Scope('row')],
                          [
                            part.part,
                            part.usage === undefined
                              ? h.empty
                              : h.small([], [part.usage]),
                          ],
                        ),
                        h.td(
                          [],
                          [
                            h.span(
                              [
                                h.Class(
                                  `f-verdict is-${VERDICT_TONES[part.verdict]}`,
                                ),
                              ],
                              [part.verdict],
                            ),
                          ],
                        ),
                        h.td([], [part.where === '' ? '—' : part.where]),
                        h.td([h.Class('f-retiring-why')], [part.why]),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ],
  )
