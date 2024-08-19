#!/usr/bin/env -S deno run --no-prompt --allow-net --allow-read=. --allow-write=.

// tsc -t esnext -m nodenext --lib esnext ip-monitor.ts && node ip-monitor.js
// deno run --no-prompt --allow-net --allow-read=. --allow-write=. ip-monitor.ts
// bun run ip-monitor.ts

"use strict";

import { open, writeFile } from "node:fs/promises";
import { EOL } from "node:os";

enum Ip {
    V4 = "ipv4",
    V6 = "ipv6",
}

try {
    const date = new Date(Date.now()).toISOString().slice(0, 10);

    const filename = import.meta.url.split("/").at(-1);
    const name = filename?.slice(0, filename.lastIndexOf("."));

    if (name == null || name === "") {
        throw new Error("Cannot determine module name");
    }

    const dataUrl = new URL(`./${name}.json`, import.meta.url);
    const dataFileHandle = await open(dataUrl, "a", 0o644);
    await dataFileHandle.close();

    let data;
    try {
        const dataModule = await import(dataUrl.toString(), {
            with: { type: "json" },
        });
        data = dataModule.default;
    } catch (_error) {
        // handled in following code
    }

    if (data == null) {
        data = {};
    }

    if (data[Ip.V4] == null) {
        data[Ip.V4] = {};
    }

    if (data[Ip.V6] == null) {
        data[Ip.V6] = {};
    }

    const ipv4 = await getIpTrace(Ip.V4);
    const ipv6 = await getIpTrace(Ip.V6);

    const currentIpv4DateSet = new Set(data?.[Ip.V4]?.[ipv4] ?? []);
    currentIpv4DateSet.add(date);
    data[Ip.V4][ipv4] = Array.from(currentIpv4DateSet);

    const currentIpv6DateSet = new Set(data?.[Ip.V6]?.[ipv6] ?? []);
    currentIpv6DateSet.add(date);
    data[Ip.V6][ipv6] = Array.from(currentIpv6DateSet);

    const json = JSON.stringify(data, null, 2);
    await writeFile(dataUrl, json + EOL);
} catch (error) {
    console.error(error);
}

async function getIpDoH(name: string, type: string): Promise<string> {
    const response = await fetch(
        new URL(`https://one.one.one.one/dns-query?name=${name}&type=${type}`),
        {
            headers: {
                Accept: "application/dns-json",
            },
        },
    );
    const result = await response.json();
    const ip = result["Answer"][0]["data"];

    if (ip == null) {
        throw new Error("No IP found");
    }

    return ip;
}

async function getIpTrace(ipVersion: Ip): Promise<string> {
    let dnsRecordType: string | null = null;

    switch (ipVersion) {
        case Ip.V4:
            dnsRecordType = "A";
            break;
        case Ip.V6:
            dnsRecordType = "AAAA";
            break;
    }

    const cloudflareTraceUrl = new URL("https://one.one.one.one/cdn-cgi/trace");
    const cloudflareIp = await getIpDoH(
        cloudflareTraceUrl.hostname,
        dnsRecordType,
    );

    switch (ipVersion) {
        case Ip.V4:
            cloudflareTraceUrl.hostname = cloudflareIp;
            break;
        case Ip.V6:
            cloudflareTraceUrl.hostname = `[${cloudflareIp}]`;
            break;
    }

    const response = await fetch(cloudflareTraceUrl);
    const result = await response.text();

    const ip = result
        .split("\n")
        .map((x) => x.trim())
        .find((line) => line.startsWith("ip"))
        ?.split("=")
        .at(-1)
        ?.trim();

    if (ip == null) {
        throw new Error("No IP found");
    }

    switch (ipVersion) {
        case Ip.V4:
            return ip;
            break;
        case Ip.V6:
            const prefix = ip
                .split(":")
                .slice(0, 4)
                .join(":")
                .concat("::");
            return prefix;
            break;
    }
}

export default {};
