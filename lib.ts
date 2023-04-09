import crypto from "crypto";

const Base32Encode = (function(BASE32_MAP:string[], bytes:Uint8Array):string {
    'use strict';
    
    if ( bytes.length < 1 ) return '';


    // Run complete bundles
    let encoded = '';
    let begin, loop = Math.floor(bytes.length/5);
    for (let run=0; run<loop; run++) {
        begin = run * 5;
        encoded += BASE32_MAP[  bytes[begin]           >> 3];								// 0
        encoded += BASE32_MAP[ (bytes[begin  ] & 0x07) << 2 | (bytes[begin+1] >> 6)];	// 1
        encoded += BASE32_MAP[ (bytes[begin+1] & 0x3E) >> 1];								// 2
        encoded += BASE32_MAP[ (bytes[begin+1] & 0x01) << 4 | (bytes[begin+2] >> 4)];	// 3
        encoded += BASE32_MAP[ (bytes[begin+2] & 0x0F) << 1 | (bytes[begin+3] >> 7)];	// 4
        encoded += BASE32_MAP[ (bytes[begin+3] & 0x7C) >> 2];								// 5
        encoded += BASE32_MAP[ (bytes[begin+3] & 0x03) << 3 | (bytes[begin+4] >> 5)];	// 6
        encoded += BASE32_MAP[  bytes[begin+4] & 0x1F];										// 7
    }

    // Run remains
    let remain = bytes.length % 5;
    if ( remain === 0 ) { return encoded; }


    begin = loop*5;
    if ( remain === 1 ) {
        encoded += BASE32_MAP[  bytes[begin]           >> 3];								// 0
        encoded += BASE32_MAP[ (bytes[begin  ] & 0x07) << 2];								// 1
    }
    else
    if ( remain === 2 ) {
        encoded += BASE32_MAP[  bytes[begin]           >> 3];								// 0
        encoded += BASE32_MAP[ (bytes[begin  ] & 0x07) << 2 | (bytes[begin+1] >> 6)];	// 1
        encoded += BASE32_MAP[ (bytes[begin+1] & 0x3E) >> 1];								// 2
        encoded += BASE32_MAP[ (bytes[begin+1] & 0x01) << 4];								// 3
    }
    else
    if ( remain === 3 ) {
        encoded += BASE32_MAP[  bytes[begin]           >> 3];								// 0
        encoded += BASE32_MAP[ (bytes[begin  ] & 0x07) << 2 | (bytes[begin+1] >> 6)];	// 1
        encoded += BASE32_MAP[ (bytes[begin+1] & 0x3E) >> 1];								// 2
        encoded += BASE32_MAP[ (bytes[begin+1] & 0x01) << 4 | (bytes[begin+2] >> 4)];	// 3
        encoded += BASE32_MAP[ (bytes[begin+2] & 0x0F) << 1];								// 4
    }
    else
    if ( remain === 4 ) {
        encoded += BASE32_MAP[  bytes[begin]           >> 3];								// 0
        encoded += BASE32_MAP[ (bytes[begin  ] & 0x07) << 2 | (bytes[begin+1] >> 6)];	// 1
        encoded += BASE32_MAP[ (bytes[begin+1] & 0x3E) >> 1];								// 2
        encoded += BASE32_MAP[ (bytes[begin+1] & 0x01) << 4 | (bytes[begin+2] >> 4)];	// 3
        encoded += BASE32_MAP[ (bytes[begin+2] & 0x0F) << 1 | (bytes[begin+3] >> 7)];	// 4
        encoded += BASE32_MAP[ (bytes[begin+3] & 0x7C) >> 2];								// 5
        encoded += BASE32_MAP[ (bytes[begin+3] & 0x03) << 3];								// 6
    }

    return encoded;
}).bind(this, '0123456789abcdefghijklmnopqrstuv'.split(''));

const Base32Decode = (function(CVT_MAP:{[key:string]:number}, inputBase32:string):Uint8Array|undefined {
    'use strict';    
    
    let remain = inputBase32.length % 8;
    if ( !(/^[0-9a-vA-V]+$/.test(inputBase32)) || [0, 2, 4, 5, 7].indexOf(remain) < 0 ) {
        return undefined;
    }

    inputBase32 = inputBase32.toLowerCase();
    let decoded = new Uint8Array(Math.floor(inputBase32.length * 5 / 8));





    // Run complete bundles
    let dest, begin, loop = Math.floor(inputBase32.length/8);
    for (let run=0; run<loop; run++) {
        begin = run * 8;
        dest  = run * 5;
        decoded[dest] 	=  CVT_MAP[inputBase32[begin]] << 3 | CVT_MAP[inputBase32[begin+1]] >> 2;	// 0
        decoded[dest+1] = (CVT_MAP[inputBase32[begin+1]] & 0x03) << 6 |								// 1
                           CVT_MAP[inputBase32[begin+2]]		   << 1 |
                           CVT_MAP[inputBase32[begin+3]]		   >> 4;
        decoded[dest+2] = (CVT_MAP[inputBase32[begin+3]] & 0x0F) << 4 |								// 2
                           CVT_MAP[inputBase32[begin+4]]		   >> 1;
        decoded[dest+3] = (CVT_MAP[inputBase32[begin+4]] & 0x01) << 7 |								// 3
                           CVT_MAP[inputBase32[begin+5]]		   << 2 |
                           CVT_MAP[inputBase32[begin+6]]		   >> 3;
        decoded[dest+4] = (CVT_MAP[inputBase32[begin+6]] & 0x07) << 5 |								// 4
                           CVT_MAP[inputBase32[begin+7]];
    }

    if ( remain === 0 ) { return decoded; }



    begin = loop*8;
    dest  = loop*5;
    if ( remain >= 2 ) {
        decoded[dest] =  CVT_MAP[inputBase32[begin]] << 3 | CVT_MAP[inputBase32[begin+1]] >> 2;		// 0
    }

    if ( remain >= 4 ) {
        decoded[dest+1] = (CVT_MAP[inputBase32[begin+1]] & 0x03) << 6 |								// 1
                           CVT_MAP[inputBase32[begin+2]]		   << 1 |
                           CVT_MAP[inputBase32[begin+3]]		   >> 4;
    }

    if ( remain >= 5 ) {
        decoded[dest+2] = (CVT_MAP[inputBase32[begin+3]] & 0x0F) << 4 |								// 2
                           CVT_MAP[inputBase32[begin+4]]		   >> 1;
    }

    if ( remain === 7 ) {
        decoded[dest+3] = (CVT_MAP[inputBase32[begin+4]] & 0x01) << 7 |								// 3
                           CVT_MAP[inputBase32[begin+5]]		   << 2 |
                           CVT_MAP[inputBase32[begin+6]]		   >> 3;
    }

    return decoded;
}).bind(this, Object.fromEntries('0123456789abcdefghijklmnopqrstuv'.split('').map((v, i)=>[v, i])));



export function GenSWT(body:{}, secret:Buffer|string):string {
	const encoded = Base32Encode(Buffer.from(JSON.stringify(body)));
	const signature = Base32Encode(crypto.createHmac('sha256', Buffer.from(secret)).update(encoded).digest());
	return encoded + 'z' + signature;
}

export function ParseSWT<PayloadType={}>(token:string, secret?:Buffer|string):null|false|PayloadType {
	const parts = token.split('z');
	if ( parts.length < 2 ) return null;

	const [encoded, signature] = parts;
	let content:string|Uint8Array|undefined = Base32Decode(encoded);
	if ( !content ) return null;
	try {
		content = Buffer.from(content).toString('utf8');
		content = JSON.parse(content);
	} catch(e) { return null; }

	if ( secret === undefined ) return content as PayloadType;
	

	const verify = Base32Encode(crypto.createHmac('sha256', Buffer.from(secret)).update(encoded).digest());
	if ( verify !== signature ) return false;
	return content as PayloadType;
}