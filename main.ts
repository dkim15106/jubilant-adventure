#!/usr/bin/env -S deno run --allow-net --allow-read
import {
    listenAndServe,
    Response,
    ServerRequest,
} from "https://deno.land/std@0.91.0/http/server.ts"
import {multiParser, Form, FormFile} from 'https://deno.land/x/multiparser@v2.1.0/mod.ts'
import {unZipFromFile} from 'https://deno.land/x/zip@v1.1.0/mod.ts'

function serverLog(req: ServerRequest, res: Response): void {
    const d = new Date().toISOString();
    const dateFmt = `[${d.slice(0, 10)} ${d.slice(11, 19)}]`;
    const s = `${dateFmt} "${req.method} ${req.url} ${req.proto}" ${res.status}`;
    console.log(s);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function serveIndexHtml(): Promise<Response> {
    const indexHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>dnd binary upload</title>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
</head>
<style>
html {
    font-family: Arial;
}
</style>
<script type="application/javascript">
function sendFile(file, resultElement) {
    console.log('sendFile', file);
    const uri = "/api/uploadFile";
    const xhr = new XMLHttpRequest();
    const fd = new FormData();

    xhr.open("POST", uri, true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4 && xhr.status === 200) {
            // alert(xhr.responseText); // handle response.
            resultElement.innerText = xhr.responseText;
        }
    };
    fd.append('myFile', file);
    // Initiate a multipart/form-data upload
    xhr.send(fd);
}
window.onload = function () {
    const result = document.getElementById('result');
    const dropzone = document.getElementById("dropzone");
    dropzone.ondragover = dropzone.ondragenter = function (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    dropzone.ondrop = function (event) {
        event.stopPropagation();
        event.preventDefault();

        const filesArray = event.dataTransfer.files;
        for (let i = 0; i < filesArray.length; i++) {
            sendFile(filesArray[i], result);
        }
    }
}
</script>
<body>
<div>
    <div id="dropzone" style="margin:30px; width:500px; height:100px; border:1px dotted grey;">Drag & drop your file here...</div>
    <div id="result"></div>
</div>
</body>
</html>
`;
    return Promise.resolve({
        status: 200,
        body: encoder.encode(indexHtml),
    });
}

function serveFallback(_req: ServerRequest, e: Error): Promise<Response> {
    if (e instanceof URIError) {
        return Promise.resolve({
            status: 400,
            body: encoder.encode("Bad Request"),
        });
    } else if (e instanceof Deno.errors.NotFound) {
        return Promise.resolve({
            status: 404,
            body: encoder.encode("Not Found"),
        });
    } else {
        return Promise.resolve({
            status: 500,
            body: encoder.encode("Internal server error"),
        });
    }
}

async function serveUploadFile(req: ServerRequest): Promise<Response> {
    let result = '';
    try {
        const form = await multiParser(req) as Form;
        if (form) {
            console.log(form)
        }
        const myFile = form.files.myFile as FormFile;
        try {
            await Deno.mkdir('tmpUpload');
        } catch(e){
            console.log('tmpUpload', e.message)
        }
        await Deno.writeFile('./tmpUpload/myFile.zip', myFile.content)

        try {
            await Deno.remove('tmpUnzip', { recursive: true });
        } catch (e) {
            console.log('tmpUnzip', e.message)
        }
        const destPath = await unZipFromFile('./tmpUpload/myFile.zip', 'tmpUnzip')
        console.log('destPath', destPath)
        if (destPath) {
            const phrasesByFilename = await getPhrasesByPath(destPath);
            const lines = [] as string[];
            for (const filename in phrasesByFilename){
                lines.push(
                    `----> ${filename}`,
                    `"${phrasesByFilename[filename].join(`" "`)}"`
                );
            }
            result = lines.join('\n');
        }
    } catch (e) {
        console.error(e)
        result = e.message
    } finally {
    }
    return Promise.resolve({
        status: 200,
        body: encoder.encode(result),
    });
}

async function getPhrasesByPath(path: string): Promise<Record<string, string[]>> {
    let phrasesByFilename = {} as {[filename: string]: string[]}
    try {
        const userSaysFiles = [] as string[];
        for await (const dirEntry of Deno.readDir(path)) {
            console.log(dirEntry.name);
            if (dirEntry.isDirectory && dirEntry.name === 'intents') {
                for await (const dirEntry2 of Deno.readDir(`${path}/intents`)) {
                    if (dirEntry2.isFile && dirEntry2.name.endsWith('_usersays_en.json')) {
                        userSaysFiles.push(dirEntry2.name);
                    }
                }
            }
        }
        const allPhrases = await Promise.all(
            userSaysFiles.map(async (filename) => {
                const filedata = await Deno.readFile(`${path}/intents/${filename}`)
                const phrases = JSON.parse(
                    decoder.decode(filedata)
                ) as {
                    data: { text: string }[]
                }[];
                return phrases.map((phrase) => {
                    return phrase.data
                        .map((data: { text: string }) => data.text)
                        .join('');
                })
            })
        )
        phrasesByFilename = userSaysFiles.reduce<Record<string, string[]>>(
            (acc, filename, index) => {
                acc[filename] = allPhrases[index];
                return acc;
            }, {})

    } catch (err) {
        console.error(err)
    } finally {
    }
    return phrasesByFilename;
}

function main(): void {
    const port = 4507;
    const host = "localhost";
    const addr = `${host}:${port}`;
    const handler = async (req: ServerRequest): Promise<void> => {
        let response: Response | undefined;
        try {
            console.log('handler')
            if (req.url === '/api/uploadFile' && req.method === 'POST') {
                console.log('upload file');
                response = await serveUploadFile(req);
            } else {
                response = await serveIndexHtml();
            }
        } catch (e) {
            console.error(e.message);
            response = await serveFallback(req, e);
        } finally {
            serverLog(req, response!);
            try {
                await req.respond(response!);
            } catch (e) {
                console.error(e.message);
            }
        }
    };

    let proto = "http";
    listenAndServe(addr, handler)
    console.log(`${proto.toUpperCase()} server listening on ${proto}://${addr}/`);
}

if (import.meta.main) {
    main();
}
