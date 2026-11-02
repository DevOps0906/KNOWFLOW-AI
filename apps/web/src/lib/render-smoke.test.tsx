import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

it("jsdom 환경에서 컴포넌트를 렌더한다", () => {
  render(<p>렌더 확인</p>);
  expect(screen.getByText("렌더 확인")).toBeTruthy();
});
