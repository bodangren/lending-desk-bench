/**
 * Item catalogue. Supports `?q=` and `?category=` filtering.
 * See spec section C.
 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  // TODO: implement (spec C)
  return null;
}
