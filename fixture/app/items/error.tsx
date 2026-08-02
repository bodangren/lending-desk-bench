"use client";

/**
 * Shown when the item catalogue fails to load. See spec section H.
 */
export default function ItemsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // TODO: implement (spec H)
  return null;
}
