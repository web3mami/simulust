import { describe, expect, it } from "vitest";
import { clientIp, ipBucket } from "@/server/http";

describe("ipBucket", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(ipBucket("192.0.2.1")).toBe("192.0.2.1");
    expect(ipBucket(" 203.0.113.77 ")).toBe("203.0.113.77");
    expect(ipBucket("unknown")).toBe("unknown");
  });

  it("counts IPv6 by its /64, however the address is written", () => {
    const bucket = "2001:db8:abcd:12::/64";
    for (const ip of [
      "2001:db8:abcd:12:1:2:3:4",
      "2001:0DB8:ABCD:0012:ffff:ffff:ffff:ffff",
      "2001:db8:abcd:12::",
      "2001:db8:abcd:12::9",
      "[2001:db8:abcd:12::1]",
      "2001:db8:abcd:12:a::b%eth0",
    ]) {
      expect(ipBucket(ip), ip).toBe(bucket);
    }
    // Another /64 is another bucket.
    expect(ipBucket("2001:db8:abcd:13::1")).toBe("2001:db8:abcd:13::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
  });

  it("treats IPv4-mapped IPv6 as the IPv4 address", () => {
    expect(ipBucket("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(ipBucket("::FFFF:c000:201")).toBe("192.0.2.1");
    expect(ipBucket("0:0:0:0:0:ffff:203.0.113.77")).toBe("203.0.113.77");
  });

  it("leaves anything that isn't an address as it came", () => {
    for (const ip of ["1::2::3", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8::", "gggg::1", "::ffff:300.1.1.1", "1.2.3.4::1"]) {
      expect(ipBucket(ip), ip).toBe(ip);
    }
  });
});

describe("clientIp", () => {
  it("reads the platform's header only, first address first", () => {
    const request = (headers: Record<string, string>) => new Request("http://localhost/", { headers });
    expect(clientIp(request({ "x-real-ip": "2001:db8::1, 10.0.0.1" }))).toBe("2001:db8::1");
    expect(clientIp(request({ "x-forwarded-for": "192.0.2.9" }))).toBe("unknown");
  });
});
