import { Profile, UnsentTargetResults } from "./api";
import * as fs from "fs";
import * as path from "path";

export interface Target {
    url: string;
    profile: Profile;
}

export interface TargetProvider {
    getTargets(): Promise<Target[]>;
}

export class ApiTargetProvider implements TargetProvider {
    constructor(private apiUrl: string) { }

    async getTargets(): Promise<Target[]> {
        const res = await fetch(this.apiUrl);
        const data: UnsentTargetResults = await res.json();
        return data.results.map(item => ({
            url: item.host.startsWith("http") ? item.host : `https://${item.host}`,
            profile: item.profile
        }));
    }
}

export class StaticProfileTargetProvider implements TargetProvider {
    constructor(private urls: string[], private profile: Profile) { }

    async getTargets(): Promise<Target[]> {
        return this.urls.map(url => ({
            url: url.startsWith("http") ? url : `https://${url}`,
            profile: this.profile
        }));
    }
}

export class FileTargetProvider implements TargetProvider {
    constructor(private filePath: string, private profile: Profile) { }

    async getTargets(): Promise<Target[]> {
        const content = await fs.promises.readFile(this.filePath, 'utf-8');
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

        // Basic CSV/TXT handling: treat each line as a URL. 
        // If CSV has commas, take the first column.
        const urls = lines.map(line => {
            const parts = line.split(",");
            return parts[0].trim();
        }).filter(u => u.length > 0);

        return urls.map(url => ({
            url: url.startsWith("http") ? url : `https://${url}`,
            profile: this.profile
        }));
    }
}
