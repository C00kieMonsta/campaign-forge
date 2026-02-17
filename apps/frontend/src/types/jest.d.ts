import "@testing-library/jest-dom";

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeInTheDocument(): R;
      toHaveClass(...classNames: string[]): R;
      toHaveAttribute(attr: string, value?: string): R;
      toHaveTextContent(text: string | RegExp): R;
      toBeVisible(): R;
      toBeDisabled(): R;
      toBeEnabled(): R;
      toBeRequired(): R;
      toHaveValue(value: string | string[] | number): R;
      toBeChecked(): R;
      toHaveFocus(): R;
      toHaveDisplayValue(value: string | RegExp | (string | RegExp)[]): R;
      toBeEmpty(): R;
      toHaveStyle(css: string | Record<string, unknown>): R;
    }
  }
}

export {};
