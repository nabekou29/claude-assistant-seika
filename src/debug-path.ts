const projectDir = process.cwd();
console.log('Original path:', projectDir);

const encoded = projectDir.replace(/[/_]/g, '-');
console.log('Encoded path:', encoded);

console.log('Expected:', '-Users-kohei-watanabe-ghq-github-com-nabekou29-claude-with-yukari-san');