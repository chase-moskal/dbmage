
import {Suite, expect} from "cynic"

import {nap} from "../nap.js"
import {sequencer} from "./sequencer.js"

export default <Suite>{
	async "single call is immediately invoked"() {
		let called = false
		const call = sequencer(async() => {
			called = true
		})
		await call()
		expect(true).ok()
	},
	async "many calls are invoked correct number of times"() {
		let called = 0
		const call = sequencer(async() => {
			called += 1
		})
		await call()
		await call()
		await call()
		expect(called).equals(3)
	},
	async "single call returns correct result"() {
		const call = sequencer(async() => {
			return "lol"
		})
		const result = await call()
		expect(result).equals("lol")
	},
	async "calls don't happen concurrently"() {
		let data: any[] = []
		async function functionThatFailsConcurrently(x: number) {
			const dataCopy = [...data]
			await nap(10)
			data = [...dataCopy, true]
		}

		// prove the function fails when called concurrently
		{
			await Promise.all([
				functionThatFailsConcurrently(1),
				functionThatFailsConcurrently(2),
			])
			expect(data.length).equals(1)
		}

		// prove the sequencer solves the problem
		{
			data = []
			const fixedFunction = sequencer(functionThatFailsConcurrently)
			await Promise.all([
				fixedFunction(1),
				fixedFunction(2),
			])
			await fixedFunction(3)
			await nap()
			await fixedFunction(4)
			expect(data.length).equals(4)
		}
	},
	async "concurrent calls return correct results"() {
		async function concurrent(x: number) {
			await nap(10)
			return x
		}
		const [a, b, c] = await Promise.all([
			concurrent(1),
			concurrent(2),
			concurrent(3),
		])
		expect(a).equals(1)
		expect(b).equals(2)
		expect(c).equals(3)
	},
	async "failed call doesn't disrupt other results"() {
		async function concurrent(x: number) {
			await nap(10)
			if (x === -1)
				throw new Error("lol")
			return x
		}
		expect(await concurrent(1)).equals(1)
		expect(await concurrent(2)).equals(2)
		await expect(async() => concurrent(-1)).throws()
		expect(await concurrent(3)).equals(3)
		expect(await concurrent(4)).equals(4)
	},
}
