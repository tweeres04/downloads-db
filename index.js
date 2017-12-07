const chokidar = require('chokidar');
const Nedb = require('nedb');
const isVideo = require('is-video');
const globby = require('globby');
const path = require('path');
const fs = require('mz/fs');
const _template = require('lodash/template');

const targetPath = process.argv[2];

const databaseFile = 'downloads-db.json';
const outputFile = 'database.html';

const db = new Nedb({
	filename: databaseFile,
	autoload: true
});

async function initializeDb() {
	await new Promise((resolve, reject) => {
		db.remove({}, { multi: true }, err => {
			if (err) {
				reject(err);
				return;
			}
			resolve();
		});
	});
	let paths = await globby(targetPath);
	paths = await paths.filter(p => isVideo(p)); //.map(p => path.basename(p));

	const stats = await Promise.all(
		paths.map(async p => ({
			name: path.basename(p),
			created: (await fs.stat(p)).ctime
		}))
	);

	await new Promise((resolve, reject) => {
		db.insert(stats, (err, newDocs) => {
			if (err) {
				reject(err);
				return;
			}
			console.log(`Saved ${newDocs.length} docs`);
		});
	});
	makeHtml();
}

async function watchFolder() {
	const watcher = chokidar.watch(targetPath, {
		persistent: true,
		ignoreInitial: true
	});

	watcher.on('add', async (p, stats) => {
		if (isVideo(p)) {
			const newRecord = {
				name: path.basename(p),
				created: stats.ctime
			};
			await new Promise((resolve, reject) => {
				db.insert(newRecord, err => {
					if (err) {
						reject(err);
						return;
					}
					resolve();
				});
			});
			console.log(`${path.basename(p)} has been added`);
			makeHtml();
		}
	});

	watcher.on('unlink', p => {
		if (isVideo(p)) {
			db.update(
				{ name: path.basename(p) },
				{ $set: { deleted: new Date() } },
				err => {
					if (err) {
						console.error(err);
						return;
					}
				}
			);
			console.log(`${path.basename(p)} has been deleted`);
			makeHtml();
		}
	});

	console.log(`Watching ${targetPath}`);
}

async function makeHtml() {
	const html = await fs.readFile('template.html');
	const downloads = await new Promise((resolve, reject) => {
		db
			.find({})
			.sort({ created: -1 })
			.exec((err, docs) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(docs);
			});
	});
	const compiled = _template(html);
	const output = compiled({ downloads });
	await fs.writeFile(outputFile, output);
	console.log(`Wrote to ${outputFile}`);
}

watchFolder();

exports.initializeDb = initializeDb;
exports.watchFolder = watchFolder;
