import { createLogger } from "@maddox-bot/shared";
import { describe, expect, it } from "vitest";
import { denyWithoutHuman } from "./denyWithoutHuman.js";

describe("denyWithoutHuman", () => {
  it("always resolves denied, regardless of the summary", async () => {
    const approve = denyWithoutHuman(createLogger("test"));
    await expect(approve("a risky shell command")).resolves.toBe("denied");
  });
});
