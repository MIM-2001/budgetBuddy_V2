import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// The JSON file. Storage only reads and writes it; the DAOs work with what is inside.
export class Storage {
  constructor(file) {
    this.file = file;
    this.data = null;
  }

  // Reads the file into this.data, or starts empty data if there is no file yet.
  open(today) {
    if (!existsSync(this.file)) {
      this.data = { version: 1, account: { historyStart: today, setupComplete: false, setupStage: 'income',
        transactions: [], categories: [], deletedOccurrences: [], challengeResponses: [] }, rules: [] };
      return;
    }
    const data = JSON.parse(readFileSync(this.file, 'utf8'));
    const lists = [data.account?.transactions, data.account?.categories, data.account?.deletedOccurrences,
      data.account?.challengeResponses, data.rules];
    if (data.version !== 1 || !lists.every(Array.isArray)) {
      throw new Error('Unrecognized data file. It has not been overwritten.');
    }
    const records = [...data.account.transactions, ...data.account.categories, ...data.rules];
    if (!records.every(record => record?.id)) {
      throw new Error('A saved record has no id. The data file has not been overwritten.');
    }
    this.data = data;
  }

  // Writes a temporary file first, so a crash never leaves a half-written file.
  commit() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
}
