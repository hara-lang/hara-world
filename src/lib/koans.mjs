import koans from "../../content/koans.json";

export const KOANS = Object.freeze(koans.map((koan) => Object.freeze(koan)));
export const koanById = (id) => KOANS.find((koan) => koan.id === String(id));
export const koanBySlug = (slug) => KOANS.find((koan) => koan.slug === String(slug));

export function publicKoan(koan) {
  return koan && { id: koan.id, version: koan.version, slug: koan.slug, title: koan.title };
}
