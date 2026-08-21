interface BoundTextInput {
  id?: string;
  type?: string;
  label?: { id?: string; text?: string };
  boundElements?: readonly { type: string }[] | null;
}

export function withStableGeneratedBoundTextIds<T extends BoundTextInput>(elements: readonly T[]): T[] {
  return elements.map((element) => {
    const hasBoundText = element.boundElements?.some((binding) => binding.type === 'text');
    if (
      !element.id ||
      element.type === 'text' ||
      !element.label?.text ||
      element.label.id ||
      hasBoundText
    ) {
      return element;
    }

    return {
      ...element,
      label: { ...element.label, id: `${element.id}-label` },
    };
  });
}
