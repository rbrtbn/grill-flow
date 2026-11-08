export const sourceQuestionHref = (
  page: string,
  source: string,
  question: string,
): string =>
  `/g/${encodeURIComponent(page)}/question/${encodeURIComponent(question)}?source=${encodeURIComponent(source)}`
