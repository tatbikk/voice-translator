export function FormError({ text }: { text: string | null }) {
  return (
    <p role="alert" aria-live="assertive" className={text ? 'mb-5 border-s-4 border-elapsed bg-elapsed-bg px-4 py-3' : 'sr-only'}>
      {text ?? ''}
    </p>
  );
}
