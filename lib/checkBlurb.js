export function checkBlurb(inp) {
    if (inp == null || !((typeof inp === 'string' || inp instanceof String))) {
        return false;
    }
    return (inp.length <= 200);
}