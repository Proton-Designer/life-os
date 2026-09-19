import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchoolStep } from "../school-step";

const createClassMock = vi.fn();
const uploadClassSyllabusMock = vi.fn();
vi.mock("@/app/(app)/school/class-actions", () => ({
  createClass: (...args: unknown[]) => createClassMock(...args),
  uploadClassSyllabus: (...args: unknown[]) => uploadClassSyllabusMock(...args),
}));

const connectCanvasMock = vi.fn();
vi.mock("@/app/(app)/settings/canvas-actions", () => ({
  connectCanvas: (...args: unknown[]) => connectCanvasMock(...args),
}));

function makeFile(name: string) {
  return new File(["x"], name, { type: "application/pdf" });
}

describe("SchoolStep — ONB item 10", () => {
  function noop() {}

  beforeEach(() => {
    createClassMock.mockReset().mockResolvedValue({ id: "class-1" });
    uploadClassSyllabusMock.mockReset().mockResolvedValue(undefined);
    connectCanvasMock.mockReset();
  });

  it("offers exactly two sources -- manual and Canvas -- never a separate upload option", () => {
    render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
    expect(screen.getByTestId("school-source-manual")).toBeInTheDocument();
    expect(screen.getByTestId("school-source-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("school-source-upload")).not.toBeInTheDocument();
  });

  it('"Setup Later" advances past the whole step without requiring any classes', async () => {
    const user = userEvent.setup();
    let called = false;
    render(<SchoolStep onBack={noop} onNext={() => (called = true)} progressTotal={4} progressIndex={2} />);
    await user.click(screen.getByTestId("school-setup-later"));
    expect(called).toBe(true);
    expect(createClassMock).not.toHaveBeenCalled();
  });

  describe("Connect Canvas -- real connect flow, not a no-op (item 10 diagnosis fix)", () => {
    it("clicking Connect Canvas navigates to a real connect screen with URL + token fields", async () => {
      const user = userEvent.setup();
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-canvas"));
      expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "school-canvas");
      expect(screen.getByTestId("school-canvas-url")).toBeInTheDocument();
      expect(screen.getByTestId("school-canvas-token")).toBeInTheDocument();
    });

    it("submitting calls the SAME connectCanvas action Settings uses -- never a reimplementation", async () => {
      const user = userEvent.setup();
      connectCanvasMock.mockResolvedValue({ ok: true, message: "Connected as Test User. 3 classes added" });
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-canvas"));
      await user.type(screen.getByTestId("school-canvas-url"), "https://school.instructure.com");
      // Never a real token in this test -- an obviously-fake string, asserting the failure/plumbing path only.
      await user.type(screen.getByTestId("school-canvas-token"), "fake-test-token-not-real");
      await user.click(screen.getByTestId("school-canvas-connect"));
      await waitFor(() => expect(connectCanvasMock).toHaveBeenCalledWith("https://school.instructure.com", "fake-test-token-not-real"));
    });

    it("a successful connect shows the real success message and a Continue button, never silently advancing", async () => {
      const user = userEvent.setup();
      connectCanvasMock.mockResolvedValue({ ok: true, message: "Connected as Test User. 3 classes added" });
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-canvas"));
      await user.type(screen.getByTestId("school-canvas-url"), "https://school.instructure.com");
      await user.type(screen.getByTestId("school-canvas-token"), "fake-test-token-not-real");
      await user.click(screen.getByTestId("school-canvas-connect"));
      expect(await screen.findByText("Connected as Test User. 3 classes added")).toBeInTheDocument();
      expect(screen.getByTestId("onboarding-next")).toBeInTheDocument();
      expect(screen.queryByTestId("school-canvas-connect")).not.toBeInTheDocument();
    });

    it("a failed connect (e.g. bad token) shows the real error and lets the user retry -- never looks dead", async () => {
      const user = userEvent.setup();
      connectCanvasMock.mockResolvedValue({ ok: false, message: "Couldn't verify that token. Check it and try again." });
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-canvas"));
      await user.type(screen.getByTestId("school-canvas-url"), "https://school.instructure.com");
      await user.type(screen.getByTestId("school-canvas-token"), "fake-test-token-not-real");
      await user.click(screen.getByTestId("school-canvas-connect"));
      expect(await screen.findByText("Couldn't verify that token. Check it and try again.")).toBeInTheDocument();
      // Still on the connect form -- not silently advanced, not stuck with no explanation.
      expect(screen.getByTestId("school-canvas-connect")).toBeInTheDocument();
      expect(screen.getByTestId("school-canvas-url")).toBeInTheDocument();
    });

    it("surfaces a key-storage-not-configured failure the same way as any other error, per the deployment concern raised in review", async () => {
      const user = userEvent.setup();
      connectCanvasMock.mockResolvedValue({ ok: false, message: "Key storage isn't configured on this deployment, so a token can't be saved securely yet." });
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-canvas"));
      await user.type(screen.getByTestId("school-canvas-url"), "https://school.instructure.com");
      await user.type(screen.getByTestId("school-canvas-token"), "fake-test-token-not-real");
      await user.click(screen.getByTestId("school-canvas-connect"));
      expect(await screen.findByText(/Key storage isn't configured/)).toBeInTheDocument();
    });

    it("Back from the Canvas screen returns to the source picker", async () => {
      const user = userEvent.setup();
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-canvas"));
      await user.click(screen.getByTestId("onboarding-back"));
      expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "school-source");
    });
  });

  describe("Manual entry with syllabus upload folded in (item 10)", () => {
    it("the manual screen offers an optional syllabus file input -- no separate upload source", async () => {
      const user = userEvent.setup();
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-manual"));
      expect(screen.getByTestId("school-manual-syllabus-file")).toBeInTheDocument();
    });

    it("a class added with no file just creates it and advances -- no empty_extraction detour", async () => {
      const user = userEvent.setup();
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-manual"));
      await user.type(screen.getByTestId("school-manual-class-name"), "Organic Chemistry");
      await user.click(screen.getByTestId("onboarding-next"));
      await waitFor(() => expect(createClassMock).toHaveBeenCalledWith({ shortName: "Organic Chemistry", code: "" }));
      expect(uploadClassSyllabusMock).not.toHaveBeenCalled();
    });

    it("a class added WITH a file creates the class, then uploads the syllabus to it, then shows the confirmation screen", async () => {
      const user = userEvent.setup();
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-manual"));
      await user.type(screen.getByTestId("school-manual-class-name"), "Organic Chemistry");
      const file = makeFile("syllabus.pdf");
      await user.upload(screen.getByTestId("school-manual-syllabus-file"), file);
      await user.click(screen.getByTestId("onboarding-next"));
      await waitFor(() => expect(uploadClassSyllabusMock).toHaveBeenCalledTimes(1));
      expect(uploadClassSyllabusMock.mock.calls[0][0]).toBe("class-1");
      expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "school-empty_extraction");
      expect(screen.getByText("syllabus.pdf")).toBeInTheDocument();
    });

    it("multiple staged classes, only some with files, upload only the ones that have one", async () => {
      const user = userEvent.setup();
      render(<SchoolStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={2} />);
      await user.click(screen.getByTestId("school-source-manual"));
      await user.type(screen.getByTestId("school-manual-class-name"), "Chem I");
      await user.upload(screen.getByTestId("school-manual-syllabus-file"), makeFile("chem.pdf"));
      await user.click(screen.getByTestId("school-manual-add-another"));
      await user.type(screen.getByTestId("school-manual-class-name"), "History");
      await user.click(screen.getByTestId("onboarding-next"));
      await waitFor(() => expect(createClassMock).toHaveBeenCalledTimes(2));
      expect(uploadClassSyllabusMock).toHaveBeenCalledTimes(1);
    });
  });
});
