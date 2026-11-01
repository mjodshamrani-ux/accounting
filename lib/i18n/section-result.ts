// The heading of a review section's result (UX-3): it names the section the
// result belongs to.
const en = {
  heading: (title: string) => `Result: ${title}`,
};

const ar: typeof en = {
  heading: (title) => `النتيجة: ${title}`,
};

export const sectionResultCopy = { en, ar };
