
import {RowStorage} from "./row-storage.js"
import {applyOperation} from "./apply-operation.js"
import {objectMap} from "../../tools/object-map.js"
import {prefixFunctions} from "./prefix-functions.js"
import {rowVersusConditional} from "./memory-conditionals.js"
import {pathToStorageKey} from "../utils/path-to-storage-key.js"
import {Action, Row, Shape, Table, Tables, Operation, RemoveIndex} from "../../types.js"

export async function memoryTransaction({
		shape, storage, action,
	}: {
		shape: Shape
		storage: RowStorage
		action: Action<Tables, any>
	}) {

	const operations: Operation.Any[] = []

	const tables = (() => {
		function recurse(shape: Shape, path: string[]): Tables {
			return objectMap(shape, (value, key) => {
				const currentPath = [...path, key]
				const storageKey = pathToStorageKey(currentPath)
				let cache: Row[] = undefined
				async function loadCacheOnce() {
					if (!cache)
						cache = await storage.load(storageKey)
				}
				return typeof value === "boolean"
					? <Table<Row>>prefixFunctions(loadCacheOnce, <RemoveIndex<Table<Row>>>{
						async create(...rows) {
							const operation: Operation.OpCreate = {
								type: Operation.Type.Create,
								path: currentPath,
								rows,
							}
							cache = applyOperation({operation, rows: cache})
							operations.push(operation)
						},
						async read(o) {
							const rows = cache.filter(row => rowVersusConditional(row, o))
							const {order, offset = 0, limit = 1000} = o
							if (order) {
								for (const [key, value] of Object.entries(order)) {
									rows.sort((a, b) =>
										value === "ascend"
											? a[key] > b[key] ? 1 : -1
											: a[key] > b[key] ? -1 : 1
									)
								}
							}
							return rows.slice(offset, offset + limit)
						},
						async update(o) {
							const operation: Operation.OpUpdate = {
								type: Operation.Type.Update,
								path: currentPath,
								update: o,
							}
							cache = applyOperation({operation, rows: cache})
							operations.push(operation)
						},
						async delete(o) {
							const operation: Operation.OpDelete = {
								type: Operation.Type.Delete,
								path: currentPath,
								conditional: o,
							}
							cache = applyOperation({operation, rows: cache})
							operations.push(operation)
						},
						async count(o) {
							const rows = cache.filter(row => rowVersusConditional(row, o))
							return rows.length
						},
						async readOne(o) {
							return cache.find(row => rowVersusConditional(row, o))
						},
					})
					: recurse(value, currentPath)
			})
		}
		return recurse(shape, [])
	})()

	let aborted = false
	const result = await action({
		tables,
		async abort() {
			aborted = true
		},
	})

	if (!aborted) {
		const loadedRows = new Map<string, Row[]>()
		for (const {path} of operations) {
			const storageKey = pathToStorageKey(path)
			const rows = await storage.load(storageKey)
			loadedRows.set(storageKey, rows)
		}
		for (const operation of operations) {
			const storageKey = pathToStorageKey(operation.path)
			const rows = loadedRows.get(storageKey)
			const modifiedRows = applyOperation({operation, rows})
			loadedRows.set(storageKey, modifiedRows)
		}
		for (const [storageKey, rows] of loadedRows.entries()) {
			await storage.save(storageKey, rows)
		}
	}

	return result
}
