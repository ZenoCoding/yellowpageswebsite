import { categories } from "./categories"
export function checkCategory(inpList) {
    for (const x of inpList) {
        var val = false;
        for (const j of categories) {
            // console.log(x + " " + j);
            if (x === j) {
                val = true;
            }
        }
        if (!val) {
            return false;
        }
    }
    return true;
}