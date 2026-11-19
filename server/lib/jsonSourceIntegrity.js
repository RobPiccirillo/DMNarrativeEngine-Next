export function duplicateJsonKeys(bytes) {
    const stack=[];
    for(const token of bytes.toString('utf8').match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g) ?? []) {
        const top=stack.at(-1);
        if(token==='{') stack.push({keys:new Set(),expectKey:true});
        else if(token==='[') stack.push({keys:null});
        else if(token==='}' || token===']') stack.pop();
        else if(token===',' && top?.keys) top.expectKey=true;
        else if(token.startsWith('"') && top?.keys && top.expectKey) {
            const k=JSON.parse(token); if(top.keys.has(k)) return true; top.keys.add(k);top.expectKey=false;
        }
    }
    return false;
}
