import type { Metadata } from "next";

/**
 * Item detail with loan history. See spec section D.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // TODO: implement (spec D)
  return {};
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // TODO: implement (spec D)
  return null;
}
