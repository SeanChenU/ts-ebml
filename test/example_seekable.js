(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var tools_1 = require("./tools");
var int64_buffer_1 = require("int64-buffer");
var tools = require("./tools");
var schema = require("matroska/lib/schema");
var byEbmlID = schema.byEbmlID;
// https://www.matroska.org/technical/specs/index.html
var State;
(function (State) {
    State[State["STATE_TAG"] = 1] = "STATE_TAG";
    State[State["STATE_SIZE"] = 2] = "STATE_SIZE";
    State[State["STATE_CONTENT"] = 3] = "STATE_CONTENT";
})(State || (State = {}));
var EBMLDecoder = /** @class */ (function () {
    function EBMLDecoder() {
        this._buffer = new tools_1.Buffer(0);
        this._tag_stack = [];
        this._state = State.STATE_TAG;
        this._cursor = 0;
        this._total = 0;
        this._schema = byEbmlID;
        this._result = [];
    }
    EBMLDecoder.prototype.decode = function (chunk) {
        this.readChunk(chunk);
        var diff = this._result;
        this._result = [];
        return diff;
    };
    EBMLDecoder.prototype.readChunk = function (chunk) {
        // 読みかけの(読めなかった) this._buffer と 新しい chunk を合わせて読み直す
        this._buffer = tools.concat([this._buffer, new tools_1.Buffer(chunk)]);
        while (this._cursor < this._buffer.length) {
            // console.log(this._cursor, this._total, this._tag_stack);
            if (this._state === State.STATE_TAG && !this.readTag()) {
                break;
            }
            if (this._state === State.STATE_SIZE && !this.readSize()) {
                break;
            }
            if (this._state === State.STATE_CONTENT && !this.readContent()) {
                break;
            }
        }
    };
    EBMLDecoder.prototype.getSchemaInfo = function (tagNum) {
        return this._schema[tagNum] || {
            name: "unknown",
            level: -1,
            type: "unknown",
            description: "unknown"
        };
    };
    /**
     * vint された parsing tag
     * @return - return false when waiting for more data
     */
    EBMLDecoder.prototype.readTag = function () {
        // tag.length が buffer の外にある
        if (this._cursor >= this._buffer.length) {
            return false;
        }
        // read ebml id vint without first byte
        var tag = tools_1.readVint(this._buffer, this._cursor);
        // tag が読めなかった
        if (tag == null) {
            return false;
        }
        // >>>>>>>>>
        // tag 識別子
        //const tagStr = this._buffer.toString("hex", this._cursor, this._cursor + tag.length);
        //const tagNum = parseInt(tagStr, 16);
        // 上と等価
        var buf = this._buffer.slice(this._cursor, this._cursor + tag.length);
        var tagNum = buf.reduce(function (o, v, i, arr) { return o + v * Math.pow(16, 2 * (arr.length - 1 - i)); }, 0);
        var schema = this.getSchemaInfo(tagNum);
        var tagObj = {
            EBML_ID: tagNum.toString(16),
            schema: schema,
            type: schema.type,
            name: schema.name,
            level: schema.level,
            tagStart: this._total,
            tagEnd: this._total + tag.length,
            sizeStart: this._total + tag.length,
            sizeEnd: null,
            dataStart: null,
            dataEnd: null,
            dataSize: null,
            data: null
        };
        // | tag: vint | size: vint | data: Buffer(size) |
        this._tag_stack.push(tagObj);
        // <<<<<<<<
        // ポインタを進める
        this._cursor += tag.length;
        this._total += tag.length;
        // 読み込み状態変更
        this._state = State.STATE_SIZE;
        return true;
    };
    /**
     * vint された現在のタグの内容の大きさを読み込む
     * @return - return false when waiting for more data
     */
    EBMLDecoder.prototype.readSize = function () {
        // tag.length が buffer の外にある
        if (this._cursor >= this._buffer.length) {
            return false;
        }
        // read ebml datasize vint without first byte
        var size = tools_1.readVint(this._buffer, this._cursor);
        // まだ読めない
        if (size == null) {
            return false;
        }
        // >>>>>>>>>
        // current tag の data size 決定
        var tagObj = this._tag_stack[this._tag_stack.length - 1];
        tagObj.sizeEnd = tagObj.sizeStart + size.length;
        tagObj.dataStart = tagObj.sizeEnd;
        tagObj.dataSize = size.value;
        if (size.value === -1) {
            // unknown size
            tagObj.dataEnd = -1;
            if (tagObj.type === "m") {
                tagObj.unknownSize = true;
            }
        }
        else {
            tagObj.dataEnd = tagObj.sizeEnd + size.value;
        }
        // <<<<<<<<
        // ポインタを進める
        this._cursor += size.length;
        this._total += size.length;
        this._state = State.STATE_CONTENT;
        return true;
    };
    /**
     * データ読み込み
     */
    EBMLDecoder.prototype.readContent = function () {
        var tagObj = this._tag_stack[this._tag_stack.length - 1];
        // master element は子要素を持つので生データはない
        if (tagObj.type === 'm') {
            // console.log('content should be tags');
            tagObj.isEnd = false;
            this._result.push(tagObj);
            this._state = State.STATE_TAG;
            // この Mastert Element は空要素か
            if (tagObj.dataSize === 0) {
                // 即座に終了タグを追加
                var elm = Object.assign({}, tagObj, { isEnd: true });
                this._result.push(elm);
                this._tag_stack.pop(); // スタックからこのタグを捨てる
            }
            return true;
        }
        // waiting for more data
        if (this._buffer.length < this._cursor + tagObj.dataSize) {
            return false;
        }
        // タグの中身の生データ
        var data = this._buffer.slice(this._cursor, this._cursor + tagObj.dataSize);
        // 読み終わったバッファを捨てて読み込んでいる部分のバッファのみ残す
        this._buffer = this._buffer.slice(this._cursor + tagObj.dataSize);
        tagObj.data = data;
        // >>>>>>>>>
        switch (tagObj.type) {
            //case "m": break;
            // Master-Element - contains other EBML sub-elements of the next lower level
            case "u":
                tagObj.value = data.readUIntBE(0, data.length);
                break;
            // Unsigned Integer - Big-endian, any size from 1 to 8 octets
            case "i":
                tagObj.value = data.readIntBE(0, data.length);
                break;
            // Signed Integer - Big-endian, any size from 1 to 8 octets
            case "f":
                tagObj.value = tagObj.dataSize === 4 ? data.readFloatBE(0) :
                    tagObj.dataSize === 8 ? data.readDoubleBE(0) :
                        (console.warn("cannot read " + tagObj.dataSize + " octets float. failback to 0"), 0);
                break;
            // Float - Big-endian, defined for 4 and 8 octets (32, 64 bits)
            case "s":
                tagObj.value = data.toString("ascii");
                break; // ascii
            //  Printable ASCII (0x20 to 0x7E), zero-padded when needed
            case "8":
                tagObj.value = data.toString("utf8");
                break;
            //  Unicode string, zero padded when needed (RFC 2279)
            case "b":
                tagObj.value = data;
                break;
            // Binary - not interpreted by the parser
            case "d":
                tagObj.value = tools_1.convertEBMLDateToJSDate(new int64_buffer_1.Int64BE(data).toNumber());
                break;
            // nano second; Date.UTC(2001,1,1,0,0,0,0) === 980985600000
            // Date - signed 8 octets integer in nanoseconds with 0 indicating 
            // the precise beginning of the millennium (at 2001-01-01T00:00:00,000000000 UTC)
        }
        if (tagObj.value === null) {
            throw new Error("unknown tag type:" + tagObj.type);
        }
        this._result.push(tagObj);
        // <<<<<<<<
        // ポインタを進める
        this._total += tagObj.dataSize;
        // タグ待ちモードに変更
        this._state = State.STATE_TAG;
        this._cursor = 0;
        this._tag_stack.pop(); // remove the object from the stack
        while (this._tag_stack.length > 0) {
            var topEle = this._tag_stack[this._tag_stack.length - 1];
            // 親が不定長サイズなので閉じタグは期待できない
            if (topEle.dataEnd < 0) {
                this._tag_stack.pop(); // 親タグを捨てる
                return true;
            }
            // 閉じタグの来るべき場所まで来たかどうか
            if (this._total < topEle.dataEnd) {
                break;
            }
            // 閉じタグを挿入すべきタイミングが来た
            if (topEle.type !== "m") {
                throw new Error("parent element is not master element");
            }
            var elm = Object.assign({}, topEle, { isEnd: true });
            this._result.push(elm);
            this._tag_stack.pop();
        }
        return true;
    };
    return EBMLDecoder;
}());
exports.default = EBMLDecoder;

},{"./tools":6,"int64-buffer":25,"matroska/lib/schema":28}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var tools = require("./tools");
var tools_1 = require("./tools");
var schema = require("matroska/lib/schema");
var byEbmlID = schema.byEbmlID;
var EBMLEncoder = /** @class */ (function () {
    function EBMLEncoder() {
        this._schema = byEbmlID;
        this._buffers = [];
        this._stack = [];
    }
    EBMLEncoder.prototype.encode = function (elms) {
        var _this = this;
        return tools.concat(elms.reduce(function (lst, elm) {
            return lst.concat(_this.encodeChunk(elm));
        }, [])).buffer;
    };
    EBMLEncoder.prototype.encodeChunk = function (elm) {
        if (elm.type === "m") {
            if (!elm.isEnd) {
                this.startTag(elm);
            }
            else {
                this.endTag(elm);
            }
        }
        else {
            this.writeTag(elm);
        }
        return this.flush();
    };
    EBMLEncoder.prototype.flush = function () {
        var ret = this._buffers;
        this._buffers = [];
        return ret;
    };
    EBMLEncoder.prototype.getSchemaInfo = function (tagName) {
        var tagNums = Object.keys(this._schema).map(Number);
        for (var i = 0; i < tagNums.length; i++) {
            var tagNum = tagNums[i];
            if (this._schema[tagNum].name === tagName) {
                return new tools_1.Buffer(tagNum.toString(16), 'hex');
            }
        }
        return null;
    };
    EBMLEncoder.prototype.writeTag = function (elm) {
        var tagName = elm.name;
        var tagId = this.getSchemaInfo(tagName);
        var tagData = elm.data;
        if (tagId == null) {
            throw new Error('No schema entry found for ' + tagName);
        }
        var data = tools.encodeTag(tagId, tagData);
        /**
         * 親要素が閉じタグあり(isEnd)なら閉じタグが来るまで待つ(children queに入る)
         */
        if (this._stack.length > 0) {
            var last = this._stack[this._stack.length - 1];
            last.children.push({
                tagId: tagId,
                elm: elm,
                children: [],
                data: data
            });
            return;
        }
        this._buffers = this._buffers.concat(data);
        return;
    };
    EBMLEncoder.prototype.startTag = function (elm) {
        var tagName = elm.name;
        var tagId = this.getSchemaInfo(tagName);
        if (tagId == null) {
            throw new Error('No schema entry found for ' + tagName);
        }
        /**
         * 閉じタグ不定長の場合はスタックに積まずに即時バッファに書き込む
         */
        if (elm.unknownSize) {
            var data = tools.encodeTag(tagId, new tools_1.Buffer(0), elm.unknownSize);
            this._buffers = this._buffers.concat(data);
            return;
        }
        var tag = {
            tagId: tagId,
            elm: elm,
            children: [],
            data: null
        };
        if (this._stack.length > 0) {
            this._stack[this._stack.length - 1].children.push(tag);
        }
        this._stack.push(tag);
    };
    EBMLEncoder.prototype.endTag = function (elm) {
        var tagName = elm.name;
        var tag = this._stack.pop();
        if (tag == null) {
            throw new Error("EBML structure is broken");
        }
        if (tag.elm.name !== elm.name) {
            throw new Error("EBML structure is broken");
        }
        var childTagDataBuffers = tag.children.reduce(function (lst, child) {
            if (child.data === null) {
                throw new Error("EBML structure is broken");
            }
            return lst.concat(child.data);
        }, []);
        var childTagDataBuffer = tools.concat(childTagDataBuffers);
        if (tag.elm.type === "m") {
            tag.data = tools.encodeTag(tag.tagId, childTagDataBuffer, tag.elm.unknownSize);
        }
        else {
            tag.data = tools.encodeTag(tag.tagId, childTagDataBuffer);
        }
        if (this._stack.length < 1) {
            this._buffers = this._buffers.concat(tag.data);
        }
    };
    return EBMLEncoder;
}());
exports.default = EBMLEncoder;

},{"./tools":6,"matroska/lib/schema":28}],3:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var events_1 = require("events");
var tools = require("./tools");
/**
 * This is an informal code for reference.
 * EBMLReader is a class for getting information to enable seeking Webm recorded by MediaRecorder.
 * So please do not use for regular WebM files.
 */
var EBMLReader = /** @class */ (function (_super) {
    __extends(EBMLReader, _super);
    function EBMLReader() {
        var _this = _super.call(this) || this;
        _this.logGroup = "";
        _this.hasLoggingStarted = false;
        _this.metadataloaded = false;
        _this.chunks = [];
        _this.stack = [];
        _this.segmentOffset = 0;
        _this.last2SimpleBlockVideoTrackTimecode = [0, 0];
        _this.last2SimpleBlockAudioTrackTimecode = [0, 0];
        _this.lastClusterTimecode = 0;
        _this.lastClusterPosition = 0;
        _this.timecodeScale = 1000000; // webm default TimecodeScale is 1ms
        _this.metadataSize = 0;
        _this.metadatas = [];
        _this.cues = [];
        _this.firstVideoBlockRead = false;
        _this.firstAudioBlockRead = false;
        _this.currentTrack = { TrackNumber: -1, TrackType: -1, DefaultDuration: null, CodecDelay: null };
        _this.trackTypes = [];
        _this.trackDefaultDuration = [];
        _this.trackCodecDelay = [];
        _this.trackInfo = { type: "nothing" };
        _this.ended = false;
        _this.logging = false;
        _this.use_duration_every_simpleblock = false;
        _this.use_webp = false;
        _this.use_segment_info = true;
        _this.drop_default_duration = true;
        return _this;
    }
    /**
     * emit final state.
     */
    EBMLReader.prototype.stop = function () {
        this.ended = true;
        this.emit_segment_info();
        // clean up any unclosed Master Elements at the end of the stream.
        while (this.stack.length) {
            this.stack.pop();
            if (this.logging) {
                console.groupEnd();
            }
        }
        // close main group if set, logging is enabled, and has actually logged anything.
        if (this.logging && this.hasLoggingStarted && this.logGroup) {
            console.groupEnd();
        }
    };
    /**
     * emit chunk info
     */
    EBMLReader.prototype.emit_segment_info = function () {
        var data = this.chunks;
        this.chunks = [];
        if (!this.metadataloaded) {
            this.metadataloaded = true;
            this.metadatas = data;
            var videoTrackNum = this.trackTypes.indexOf(1); // find first video track
            var audioTrackNum = this.trackTypes.indexOf(2); // find first audio track
            this.trackInfo = videoTrackNum >= 0 && audioTrackNum >= 0 ? { type: "both", trackNumber: videoTrackNum }
                : videoTrackNum >= 0 ? { type: "video", trackNumber: videoTrackNum }
                    : audioTrackNum >= 0 ? { type: "audio", trackNumber: audioTrackNum }
                        : { type: "nothing" };
            if (!this.use_segment_info) {
                return;
            }
            this.emit("metadata", { data: data, metadataSize: this.metadataSize });
        }
        else {
            if (!this.use_segment_info) {
                return;
            }
            var timecode = this.lastClusterTimecode;
            var duration = this.duration;
            var timecodeScale = this.timecodeScale;
            this.emit("cluster", { timecode: timecode, data: data });
            this.emit("duration", { timecodeScale: timecodeScale, duration: duration });
        }
    };
    EBMLReader.prototype.read = function (elm) {
        var _this = this;
        var drop = false;
        if (this.ended) {
            // reader is finished
            return;
        }
        if (elm.type === "m") {
            // 閉じタグの自動挿入
            if (elm.isEnd) {
                this.stack.pop();
            }
            else {
                var parent_1 = this.stack[this.stack.length - 1];
                if (parent_1 != null && parent_1.level >= elm.level) {
                    // 閉じタグなしでレベルが下がったら閉じタグを挿入
                    this.stack.pop();
                    // From http://w3c.github.io/media-source/webm-byte-stream-format.html#webm-media-segments
                    // This fixes logging for webm streams with Cluster of unknown length and no Cluster closing elements.
                    if (this.logging) {
                        console.groupEnd();
                    }
                    parent_1.dataEnd = elm.dataEnd;
                    parent_1.dataSize = elm.dataEnd - parent_1.dataStart;
                    parent_1.unknownSize = false;
                    var o = Object.assign({}, parent_1, { name: parent_1.name, type: parent_1.type, isEnd: true });
                    this.chunks.push(o);
                }
                this.stack.push(elm);
            }
        }
        if (elm.type === "m" && elm.name == "Segment") {
            if (this.segmentOffset != 0) {
                console.warn("Multiple segments detected!");
            }
            this.segmentOffset = elm.dataStart;
            this.emit("segment_offset", this.segmentOffset);
        }
        else if (elm.type === "b" && elm.name === "SimpleBlock") {
            var _a = tools.ebmlBlock(elm.data), timecode = _a.timecode, trackNumber = _a.trackNumber, frames_1 = _a.frames;
            if (this.trackTypes[trackNumber] === 1) { // trackType === 1 => video track
                if (!this.firstVideoBlockRead) {
                    this.firstVideoBlockRead = true;
                    if (this.trackInfo.type === "both" || this.trackInfo.type === "video") {
                        var CueTime = this.lastClusterTimecode + timecode;
                        this.cues.push({ CueTrack: trackNumber, CueClusterPosition: this.lastClusterPosition, CueTime: CueTime });
                        this.emit("cue_info", { CueTrack: trackNumber, CueClusterPosition: this.lastClusterPosition, CueTime: this.lastClusterTimecode });
                        this.emit("cue", { CueTrack: trackNumber, CueClusterPosition: this.lastClusterPosition, CueTime: CueTime });
                    }
                }
                this.last2SimpleBlockVideoTrackTimecode = [this.last2SimpleBlockVideoTrackTimecode[1], timecode];
            }
            else if (this.trackTypes[trackNumber] === 2) { // trackType === 2 => audio track
                if (!this.firstAudioBlockRead) {
                    this.firstAudioBlockRead = true;
                    if (this.trackInfo.type === "audio") {
                        var CueTime = this.lastClusterTimecode + timecode;
                        this.cues.push({ CueTrack: trackNumber, CueClusterPosition: this.lastClusterPosition, CueTime: CueTime });
                        this.emit("cue_info", { CueTrack: trackNumber, CueClusterPosition: this.lastClusterPosition, CueTime: this.lastClusterTimecode });
                        this.emit("cue", { CueTrack: trackNumber, CueClusterPosition: this.lastClusterPosition, CueTime: CueTime });
                    }
                }
                this.last2SimpleBlockAudioTrackTimecode = [this.last2SimpleBlockAudioTrackTimecode[1], timecode];
            }
            if (this.use_duration_every_simpleblock) {
                this.emit("duration", { timecodeScale: this.timecodeScale, duration: this.duration });
            }
            if (this.use_webp) {
                frames_1.forEach(function (frame) {
                    var startcode = frame.slice(3, 6).toString("hex");
                    if (startcode !== "9d012a") {
                        return;
                    }
                    ; // VP8 の場合
                    var webpBuf = tools.VP8BitStreamToRiffWebPBuffer(frame);
                    var webp = new Blob([webpBuf], { type: "image/webp" });
                    var currentTime = _this.duration;
                    _this.emit("webp", { currentTime: currentTime, webp: webp });
                });
            }
        }
        else if (elm.type === "m" && elm.name === "Cluster" && elm.isEnd === false) {
            this.firstVideoBlockRead = false;
            this.firstAudioBlockRead = false;
            this.emit_segment_info();
            this.emit("cluster_ptr", elm.tagStart);
            this.lastClusterPosition = elm.tagStart;
        }
        else if (elm.type === "u" && elm.name === "Timecode") {
            this.lastClusterTimecode = elm.value;
        }
        else if (elm.type === "u" && elm.name === "TimecodeScale") {
            this.timecodeScale = elm.value;
        }
        else if (elm.type === "m" && elm.name === "TrackEntry") {
            if (elm.isEnd) {
                this.trackTypes[this.currentTrack.TrackNumber] = this.currentTrack.TrackType;
                this.trackDefaultDuration[this.currentTrack.TrackNumber] = this.currentTrack.DefaultDuration;
                this.trackCodecDelay[this.currentTrack.TrackNumber] = this.currentTrack.CodecDelay;
            }
            else {
                this.currentTrack = { TrackNumber: -1, TrackType: -1, DefaultDuration: null, CodecDelay: null };
            }
        }
        else if (elm.type === "u" && elm.name === "TrackType") {
            this.currentTrack.TrackType = elm.value;
        }
        else if (elm.type === "u" && elm.name === "TrackNumber") {
            this.currentTrack.TrackNumber = elm.value;
        }
        else if (elm.type === "u" && elm.name === "CodecDelay") {
            this.currentTrack.CodecDelay = elm.value;
        }
        else if (elm.type === "u" && elm.name === "DefaultDuration") {
            // media source api は DefaultDuration を計算するとバグる。
            // https://bugs.chromium.org/p/chromium/issues/detail?id=606000#c22
            // chrome 58 ではこれを回避するために DefaultDuration 要素を抜き取った。
            // chrome 58 以前でもこのタグを抜き取ることで回避できる
            if (this.drop_default_duration) {
                console.warn("DefaultDuration detected!, remove it");
                drop = true;
            }
            else {
                this.currentTrack.DefaultDuration = elm.value;
            }
        }
        else if (elm.name === "unknown") {
            console.warn(elm);
        }
        if (!this.metadataloaded && elm.dataEnd > 0) {
            this.metadataSize = elm.dataEnd;
        }
        if (!drop) {
            this.chunks.push(elm);
        }
        if (this.logging) {
            this.put(elm);
        }
    };
    Object.defineProperty(EBMLReader.prototype, "duration", {
        /**
         * DefaultDuration が定義されている場合は最後のフレームのdurationも考慮する
         * 単位 timecodeScale
         *
         * !!! if you need duration with seconds !!!
         * ```js
         * const nanosec = reader.duration * reader.timecodeScale;
         * const sec = nanosec / 1000 / 1000 / 1000;
         * ```
         */
        get: function () {
            if (this.trackInfo.type === "nothing") {
                console.warn("no video, no audio track");
                return 0;
            }
            // defaultDuration は 生の nano sec
            var defaultDuration = 0;
            // nanoseconds
            var codecDelay = 0;
            var lastTimecode = 0;
            var _defaultDuration = this.trackDefaultDuration[this.trackInfo.trackNumber];
            if (typeof _defaultDuration === "number") {
                defaultDuration = _defaultDuration;
            }
            else {
                // https://bugs.chromium.org/p/chromium/issues/detail?id=606000#c22
                // default duration がないときに使う delta
                if (this.trackInfo.type === "both") {
                    if (this.last2SimpleBlockAudioTrackTimecode[1] > this.last2SimpleBlockVideoTrackTimecode[1]) {
                        // audio diff
                        defaultDuration = (this.last2SimpleBlockAudioTrackTimecode[1] - this.last2SimpleBlockAudioTrackTimecode[0]) * this.timecodeScale;
                        // audio delay
                        var delay = this.trackCodecDelay[this.trackTypes.indexOf(2)]; // 2 => audio
                        if (typeof delay === "number") {
                            codecDelay = delay;
                        }
                        // audio timecode
                        lastTimecode = this.last2SimpleBlockAudioTrackTimecode[1];
                    }
                    else {
                        // video diff
                        defaultDuration = (this.last2SimpleBlockVideoTrackTimecode[1] - this.last2SimpleBlockVideoTrackTimecode[0]) * this.timecodeScale;
                        // video delay
                        var delay = this.trackCodecDelay[this.trackTypes.indexOf(1)]; // 1 => video
                        if (typeof delay === "number") {
                            codecDelay = delay;
                        }
                        // video timecode
                        lastTimecode = this.last2SimpleBlockVideoTrackTimecode[1];
                    }
                }
                else if (this.trackInfo.type === "video") {
                    defaultDuration = (this.last2SimpleBlockVideoTrackTimecode[1] - this.last2SimpleBlockVideoTrackTimecode[0]) * this.timecodeScale;
                    var delay = this.trackCodecDelay[this.trackInfo.trackNumber]; // 2 => audio
                    if (typeof delay === "number") {
                        codecDelay = delay;
                    }
                    lastTimecode = this.last2SimpleBlockVideoTrackTimecode[1];
                }
                else if (this.trackInfo.type === "audio") {
                    defaultDuration = (this.last2SimpleBlockAudioTrackTimecode[1] - this.last2SimpleBlockAudioTrackTimecode[0]) * this.timecodeScale;
                    var delay = this.trackCodecDelay[this.trackInfo.trackNumber]; // 1 => video
                    if (typeof delay === "number") {
                        codecDelay = delay;
                    }
                    lastTimecode = this.last2SimpleBlockAudioTrackTimecode[1];
                } // else { not reached }
            }
            // convert to timecodescale
            var duration_nanosec = ((this.lastClusterTimecode + lastTimecode) * this.timecodeScale) + defaultDuration - codecDelay;
            var duration = duration_nanosec / this.timecodeScale;
            return Math.floor(duration);
        },
        enumerable: true,
        configurable: true
    });
    EBMLReader.prototype.addListener = function (event, listener) {
        return _super.prototype.addListener.call(this, event, listener);
    };
    EBMLReader.prototype.put = function (elm) {
        if (!this.hasLoggingStarted) {
            this.hasLoggingStarted = true;
            if (this.logging && this.logGroup) {
                console.groupCollapsed(this.logGroup);
            }
        }
        if (elm.type === "m") {
            if (elm.isEnd) {
                console.groupEnd();
            }
            else {
                console.group(elm.name + ":" + elm.tagStart);
            }
        }
        else if (elm.type === "b") {
            // for debug
            //if(elm.name === "SimpleBlock"){
            //const o = EBML.tools.ebmlBlock(elm.value);
            //console.log(elm.name, elm.type, o.trackNumber, o.timecode);
            //}else{
            console.log(elm.name, elm.type);
            //}
        }
        else {
            console.log(elm.name, elm.tagStart, elm.type, elm.value);
        }
    };
    return EBMLReader;
}(events_1.EventEmitter));
exports.default = EBMLReader;
;
;
;
;

},{"./tools":6,"events":54}],4:[function(require,module,exports){
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var _1 = require("./");
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var params, recorder, duration, codec, file;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    params = new URLSearchParams(location.search);
                    recorder = false;
                    duration = 60;
                    codec = "vp8";
                    if (params.has("type") && params.get("type") == "recorder")
                        recorder = true;
                    if (params.has("duration"))
                        duration = parseInt(params.get("duration") || "60");
                    if (params.has("codec"))
                        codec = params.get("codec") || "vp8";
                    if (!recorder) return [3 /*break*/, 2];
                    return [4 /*yield*/, main_from_recorder(duration, codec)];
                case 1:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 2:
                    file = params.has("file") ? params.get("file") : "./chrome57.webm";
                    return [4 /*yield*/, main_from_file(file)];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4: return [2 /*return*/];
            }
        });
    });
}
function main_from_file(file) {
    return __awaiter(this, void 0, void 0, function () {
        var decoder, reader, webMBuf, elms, refinedMetadataBuf, body, refinedWebM, refined_video, refinedDecoder, refinedReader, refinedBuf, refinedElms;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    decoder = new _1.Decoder();
                    reader = new _1.Reader();
                    reader.logging = true;
                    reader.logGroup = "Raw WebM file";
                    reader.drop_default_duration = false;
                    return [4 /*yield*/, fetch(file).then(function (res) { return res.arrayBuffer(); })];
                case 1:
                    webMBuf = _a.sent();
                    elms = decoder.decode(webMBuf);
                    elms.forEach(function (elm) { reader.read(elm); });
                    reader.stop();
                    refinedMetadataBuf = _1.tools.makeMetadataSeekable(reader.metadatas, reader.duration, reader.cues);
                    body = webMBuf.slice(reader.metadataSize);
                    refinedWebM = new Blob([refinedMetadataBuf, body], { type: "video/webm" });
                    refined_video = document.createElement("video");
                    refined_video.src = URL.createObjectURL(refinedWebM);
                    refined_video.controls = true;
                    document.body.appendChild(refined_video);
                    refinedDecoder = new _1.Decoder();
                    refinedReader = new _1.Reader();
                    refinedReader.logging = true;
                    refinedReader.logGroup = "Refined WebM file";
                    return [4 /*yield*/, readAsArrayBuffer(refinedWebM)];
                case 2:
                    refinedBuf = _a.sent();
                    refinedElms = refinedDecoder.decode(refinedBuf);
                    refinedElms.forEach(function (elm) { refinedReader.read(elm); });
                    refinedReader.stop();
                    return [2 /*return*/];
            }
        });
    });
}
function main_from_recorder(duration, codec) {
    return __awaiter(this, void 0, void 0, function () {
        var decoder, reader, tasks, webM, devices, stream, rec, ondataavailable, count, raw_video, rawVideoButton, infos, _loop_1, _i, infos_1, info;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    decoder = new _1.Decoder();
                    reader = new _1.Reader();
                    reader.logging = true;
                    reader.logGroup = "Raw WebM Stream (not seekable)";
                    tasks = Promise.resolve(void 0);
                    webM = new Blob([], { type: "video/webm" });
                    return [4 /*yield*/, navigator.mediaDevices.enumerateDevices()];
                case 1:
                    devices = _a.sent();
                    console.table(devices);
                    return [4 /*yield*/, (navigator.mediaDevices.getUserMedia instanceof Function ? navigator.mediaDevices.getUserMedia({ video: true, audio: true }) :
                            navigator.getUserMedia instanceof Function ? new Promise(function (resolve, reject) { return navigator.getUserMedia({ video: true, audio: true }, resolve, reject); }) :
                                navigator["webkitGetUserMedia"] instanceof Function ? new Promise(function (resolve, reject) { return navigator["webkitGetUserMedia"]({ video: true, audio: true }, resolve, reject); }) :
                                    Promise.reject(new Error("cannot use usermedia")))];
                case 2:
                    stream = _a.sent();
                    rec = new MediaRecorder(stream, { mimeType: "video/webm; codecs=\"" + codec + ", opus\"" });
                    ondataavailable = function (ev) {
                        var chunk = ev.data;
                        webM = new Blob([webM, chunk], { type: chunk.type });
                        var task = function () { return __awaiter(_this, void 0, void 0, function () {
                            var buf, elms;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, readAsArrayBuffer(chunk)];
                                    case 1:
                                        buf = _a.sent();
                                        elms = decoder.decode(buf);
                                        elms.forEach(function (elm) { reader.read(elm); });
                                        return [2 /*return*/];
                                }
                            });
                        }); };
                        tasks = tasks.then(function () { return task(); });
                    };
                    rec.addEventListener("dataavailable", ondataavailable);
                    // if set timeslice, bug occur on firefox: https://bugzilla.mozilla.org/show_bug.cgi?id=1272371
                    // rec.start(100);
                    rec.start();
                    return [4 /*yield*/, sleep(duration * 1000)];
                case 3:
                    _a.sent();
                    rec.stop();
                    count = 0;
                    _a.label = 4;
                case 4:
                    if (!(webM.size === 0)) return [3 /*break*/, 6];
                    if (count > 10) {
                        alert("MediaRecorder did not record anything");
                        throw new Error("MediaRecorder did not record anything");
                    }
                    return [4 /*yield*/, sleep(1 * 1000)];
                case 5:
                    _a.sent(); // wait dataavailable event
                    count++;
                    return [3 /*break*/, 4];
                case 6:
                    rec.removeEventListener("dataavailable", ondataavailable);
                    rec.stream.getTracks().map(function (track) { track.stop(); });
                    return [4 /*yield*/, tasks];
                case 7:
                    _a.sent(); // wait data processing
                    reader.stop();
                    raw_video = document.createElement("video");
                    raw_video.src = URL.createObjectURL(webM);
                    raw_video.controls = true;
                    rawVideoButton = document.createElement("button");
                    rawVideoButton.textContent = "Download Raw Video";
                    rawVideoButton.addEventListener("click", function () { saveData(webM, "raw.webm"); });
                    put(raw_video, "Raw WebM Stream (not seekable)");
                    document.body.appendChild(document.createElement("br"));
                    document.body.appendChild(rawVideoButton);
                    infos = [
                        //{duration: reader.duration, title: "add duration only (seekable but slow)"},
                        //{cues: reader.cues, title: "add cues only (seekable file)"},
                        { duration: reader.duration, cues: reader.cues, title: "Refined WebM stream (seekable)" },
                    ];
                    _loop_1 = function (info) {
                        var refinedMetadataBuf, webMBuf, body, refinedWebM, refinedBuf, _reader, refined_video, refinedVideoButton;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    refinedMetadataBuf = _1.tools.makeMetadataSeekable(reader.metadatas, reader.duration, reader.cues);
                                    return [4 /*yield*/, readAsArrayBuffer(webM)];
                                case 1:
                                    webMBuf = _a.sent();
                                    body = webMBuf.slice(reader.metadataSize);
                                    refinedWebM = new Blob([refinedMetadataBuf, body], { type: webM.type });
                                    return [4 /*yield*/, readAsArrayBuffer(refinedWebM)];
                                case 2:
                                    refinedBuf = _a.sent();
                                    _reader = new _1.Reader();
                                    _reader.logging = true;
                                    _reader.logGroup = info.title;
                                    new _1.Decoder().decode(refinedBuf).forEach(function (elm) { return _reader.read(elm); });
                                    _reader.stop();
                                    refined_video = document.createElement("video");
                                    refined_video.src = URL.createObjectURL(refinedWebM);
                                    refined_video.controls = true;
                                    refinedVideoButton = document.createElement("button");
                                    refinedVideoButton.textContent = "Download Refined Video";
                                    refinedVideoButton.addEventListener("click", function () { saveData(refinedWebM, "refined.webm"); });
                                    put(refined_video, info.title);
                                    document.body.appendChild(document.createElement("br"));
                                    document.body.appendChild(refinedVideoButton);
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, infos_1 = infos;
                    _a.label = 8;
                case 8:
                    if (!(_i < infos_1.length)) return [3 /*break*/, 11];
                    info = infos_1[_i];
                    return [5 /*yield**/, _loop_1(info)];
                case 9:
                    _a.sent();
                    _a.label = 10;
                case 10:
                    _i++;
                    return [3 /*break*/, 8];
                case 11: return [2 /*return*/];
            }
        });
    });
}
function put(elm, title) {
    var h1 = document.createElement("h1");
    h1.appendChild(document.createTextNode(title));
    document.body.appendChild(h1);
    document.body.appendChild(elm);
}
function readAsArrayBuffer(blob) {
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.readAsArrayBuffer(blob);
        reader.onloadend = function () { resolve(reader.result); };
        reader.onerror = function (ev) { reject(ev.error); };
    });
}
function sleep(ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
}
var saveData = (function () {
    var a = document.createElement("a");
    document.body.appendChild(a);
    a.setAttribute("style", "display: none");
    return function (blob, fileName) {
        var url = window.URL.createObjectURL(blob);
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
    };
}());
main();

},{"./":5}],5:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var EBMLDecoder_1 = require("./EBMLDecoder");
exports.Decoder = EBMLDecoder_1.default;
var EBMLEncoder_1 = require("./EBMLEncoder");
exports.Encoder = EBMLEncoder_1.default;
var EBMLReader_1 = require("./EBMLReader");
exports.Reader = EBMLReader_1.default;
var tools = require("./tools");
exports.tools = tools;

},{"./EBMLDecoder":1,"./EBMLEncoder":2,"./EBMLReader":3,"./tools":6}],6:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/// <reference types="node"/>
var int64_buffer_1 = require("int64-buffer");
var EBMLEncoder_1 = require("./EBMLEncoder");
var _Buffer = require("buffer/");
var ebml_1 = require("ebml");
var _block = require("ebml-block");
exports.Buffer = _Buffer.Buffer;
exports.readVint = ebml_1.tools.readVint;
exports.writeVint = ebml_1.tools.writeVint;
exports.ebmlBlock = _block;
function readBlock(buf) {
    return exports.ebmlBlock(new exports.Buffer(buf));
}
exports.readBlock = readBlock;
/**
  * @param end - if end === false then length is unknown
  */
function encodeTag(tagId, tagData, unknownSize) {
    if (unknownSize === void 0) { unknownSize = false; }
    return concat([
        tagId,
        unknownSize ?
            new exports.Buffer('01ffffffffffffff', 'hex') :
            exports.writeVint(tagData.length),
        tagData
    ]);
}
exports.encodeTag = encodeTag;
/**
 * @return - SimpleBlock to WebP Filter
 */
function WebPFrameFilter(elms) {
    return WebPBlockFilter(elms).reduce(function (lst, elm) {
        var o = exports.ebmlBlock(elm.data);
        return o.frames.reduce(function (lst, frame) {
            // https://developers.Blob.com/speed/webp/docs/riff_container
            var webpBuf = VP8BitStreamToRiffWebPBuffer(frame);
            var webp = new Blob([webpBuf], { type: "image/webp" });
            return lst.concat(webp);
        }, lst);
    }, []);
}
exports.WebPFrameFilter = WebPFrameFilter;
/**
 * WebP ファイルにできる SimpleBlock の パスフィルタ
 */
function WebPBlockFilter(elms) {
    return elms.reduce(function (lst, elm) {
        if (elm.type !== "b") {
            return lst;
        }
        if (elm.name !== "SimpleBlock") {
            return lst;
        }
        var o = exports.ebmlBlock(elm.data);
        var hasWebP = o.frames.some(function (frame) {
            // https://tools.ietf.org/html/rfc6386#section-19.1
            var startcode = frame.slice(3, 6).toString("hex");
            return startcode === "9d012a";
        });
        if (!hasWebP) {
            return lst;
        }
        return lst.concat(elm);
    }, []);
}
exports.WebPBlockFilter = WebPBlockFilter;
/**
 * @param frame - VP8 BitStream のうち startcode をもつ frame
 * @return - WebP ファイルの ArrayBuffer
 */
function VP8BitStreamToRiffWebPBuffer(frame) {
    var VP8Chunk = createRIFFChunk("VP8 ", frame);
    var WebPChunk = concat([
        new exports.Buffer("WEBP", "ascii"),
        VP8Chunk
    ]);
    return createRIFFChunk("RIFF", WebPChunk);
}
exports.VP8BitStreamToRiffWebPBuffer = VP8BitStreamToRiffWebPBuffer;
/**
 * RIFF データチャンクを作る
 */
function createRIFFChunk(FourCC, chunk) {
    var chunkSize = new exports.Buffer(4);
    chunkSize.writeUInt32LE(chunk.byteLength, 0);
    return concat([
        new exports.Buffer(FourCC.substr(0, 4), "ascii"),
        chunkSize,
        chunk,
        new exports.Buffer(chunk.byteLength % 2 === 0 ? 0 : 1) // padding
    ]);
}
exports.createRIFFChunk = createRIFFChunk;
/* Original Metadata

 m  0	EBML
 u  1	  EBMLVersion 1
 u  1	  EBMLReadVersion 1
 u  1	  EBMLMaxIDLength 4
 u  1	  EBMLMaxSizeLength 8
 s  1	  DocType webm
 u  1	  DocTypeVersion 4
 u  1	  DocTypeReadVersion 2
 m  0	Segment
 m  1	  Info                                segmentContentStartPos, all CueClusterPositions provided in info.cues will be relative to here and will need adjusted
 u  2	    TimecodeScale 1000000
 8  2	    MuxingApp Chrome
 8  2	    WritingApp Chrome
 m  1	  Tracks                              tracksStartPos
 m  2	    TrackEntry
 u  3	      TrackNumber 1
 u  3	      TrackUID 31790271978391090
 u  3	      TrackType 2
 s  3	      CodecID A_OPUS
 b  3	      CodecPrivate <Buffer 19>
 m  3	      Audio
 f  4	        SamplingFrequency 48000
 u  4	        Channels 1
 m  2	    TrackEntry
 u  3	      TrackNumber 2
 u  3	      TrackUID 24051277436254136
 u  3	      TrackType 1
 s  3	      CodecID V_VP8
 m  3	      Video
 u  4	        PixelWidth 1024
 u  4	        PixelHeight 576
 m  1	  Cluster                             clusterStartPos
 u  2	    Timecode 0
 b  2	    SimpleBlock track:2 timecode:0	keyframe:true	invisible:false	discardable:false	lacing:1
*/
/* Desired Metadata

 m	0 EBML
 u	1   EBMLVersion 1
 u	1   EBMLReadVersion 1
 u	1   EBMLMaxIDLength 4
 u	1   EBMLMaxSizeLength 8
 s	1   DocType webm
 u	1   DocTypeVersion 4
 u	1   DocTypeReadVersion 2
 m	0 Segment
 m	1   SeekHead                            -> This is SeekPosition 0, so all SeekPositions can be calculated as (bytePos - segmentContentStartPos), which is 44 in this case
 m	2     Seek
 b	3       SeekID                          -> Buffer([0x15, 0x49, 0xA9, 0x66])  Info
 u	3       SeekPosition                    -> infoStartPos =
 m	2     Seek
 b	3       SeekID                          -> Buffer([0x16, 0x54, 0xAE, 0x6B])  Tracks
 u	3       SeekPosition { tracksStartPos }
 m	2     Seek
 b	3       SeekID                          -> Buffer([0x1C, 0x53, 0xBB, 0x6B])  Cues
 u	3       SeekPosition { cuesStartPos }
 m	1   Info
 f	2     Duration 32480                    -> overwrite, or insert if it doesn't exist
 u	2     TimecodeScale 1000000
 8	2     MuxingApp Chrome
 8	2     WritingApp Chrome
 m	1   Tracks
 m	2     TrackEntry
 u	3       TrackNumber 1
 u	3       TrackUID 31790271978391090
 u	3       TrackType 2
 s	3       CodecID A_OPUS
 b	3       CodecPrivate <Buffer 19>
 m	3       Audio
 f	4         SamplingFrequency 48000
 u	4         Channels 1
 m	2     TrackEntry
 u	3       TrackNumber 2
 u	3       TrackUID 24051277436254136
 u	3       TrackType 1
 s	3       CodecID V_VP8
 m	3       Video
 u	4         PixelWidth 1024
 u	4         PixelHeight 576
 m  1   Cues                                -> cuesStartPos
 m  2     CuePoint
 u  3       CueTime 0
 m  3       CueTrackPositions
 u  4         CueTrack 1
 u  4         CueClusterPosition 3911
 m  2     CuePoint
 u  3       CueTime 600
 m  3       CueTrackPositions
 u  4         CueTrack 1
 u  4         CueClusterPosition 3911
 m  1   Cluster
 u  2     Timecode 0
 b  2     SimpleBlock track:2 timecode:0	keyframe:true	invisible:false	discardable:false	lacing:1
*/
/**
 * convert the metadata from a streaming webm bytestream to a seekable file by inserting Duration, Seekhead and Cues
 * @param originalMetadata - orginal metadata (everything before the clusters start) from media recorder
 * @param duration - Duration (TimecodeScale)
 * @param cues - cue points for clusters
 */
function makeMetadataSeekable(originalMetadata, duration, cuesInfo) {
    // extract the header, we can reuse this as-is
    var header = extractElement("EBML", originalMetadata);
    var headerSize = encodedSizeOfEbml(header);
    //console.error("Header size: " + headerSize);
    //printElementIds(header);
    // After the header comes the Segment open tag, which in this implementation is always 12 bytes (4 byte id, 8 byte 'unknown length')
    // After that the segment content starts. All SeekPositions and CueClusterPosition must be relative to segmentContentStartPos
    var segmentContentStartPos = headerSize + 12;
    //console.error("segmentContentStartPos: " + segmentContentStartPos);    
    // find the original metadata size, and adjust it for header size and Segment start element so we can keep all positions relative to segmentContentStartPos
    var originalMetadataSize = originalMetadata[originalMetadata.length - 1].dataEnd - segmentContentStartPos;
    //console.error("Original Metadata size: " + originalMetadataSize);
    //printElementIds(originalMetadata);
    // extract the segment info, remove the potentially existing Duration element, and add our own one.
    var info = extractElement("Info", originalMetadata);
    removeElement("Duration", info);
    info.splice(1, 0, { name: "Duration", type: "f", data: createFloatBuffer(duration, 8) });
    var infoSize = encodedSizeOfEbml(info);
    //console.error("Info size: " + infoSize);
    //printElementIds(info);  
    // extract the track info, we can re-use this as is
    var tracks = extractElement("Tracks", originalMetadata);
    var tracksSize = encodedSizeOfEbml(tracks);
    //console.error("Tracks size: " + tracksSize);
    //printElementIds(tracks);  
    var seekHeadSize = 47; // Initial best guess, but could be slightly larger if the Cues element is huge.
    var seekHead = [];
    var cuesSize = 5 + cuesInfo.length * 15; // very rough initial approximation, depends a lot on file size and number of CuePoints                   
    var cues = [];
    var lastSizeDifference = -1; // 
    // The size of SeekHead and Cues elements depends on how many bytes the offsets values can be encoded in.
    // The actual offsets in CueClusterPosition depend on the final size of the SeekHead and Cues elements
    // We need to iteratively converge to a stable solution.
    var maxIterations = 10;
    var _loop_1 = function (i) {
        // SeekHead starts at 0
        var infoStart = seekHeadSize; // Info comes directly after SeekHead
        var tracksStart = infoStart + infoSize; // Tracks comes directly after Info
        var cuesStart = tracksStart + tracksSize; // Cues starts directly after 
        var newMetadataSize = cuesStart + cuesSize; // total size of metadata  
        // This is the offset all CueClusterPositions should be adjusted by due to the metadata size changing.
        var sizeDifference = newMetadataSize - originalMetadataSize;
        // console.error(`infoStart: ${infoStart}, infoSize: ${infoSize}`);
        // console.error(`tracksStart: ${tracksStart}, tracksSize: ${tracksSize}`);
        // console.error(`cuesStart: ${cuesStart}, cuesSize: ${cuesSize}`);
        // console.error(`originalMetadataSize: ${originalMetadataSize}, newMetadataSize: ${newMetadataSize}, sizeDifference: ${sizeDifference}`); 
        // create the SeekHead element
        seekHead = [];
        seekHead.push({ name: "SeekHead", type: "m", isEnd: false });
        seekHead.push({ name: "Seek", type: "m", isEnd: false });
        seekHead.push({ name: "SeekID", type: "b", data: new exports.Buffer([0x15, 0x49, 0xA9, 0x66]) }); // Info
        seekHead.push({ name: "SeekPosition", type: "u", data: createUIntBuffer(infoStart) });
        seekHead.push({ name: "Seek", type: "m", isEnd: true });
        seekHead.push({ name: "Seek", type: "m", isEnd: false });
        seekHead.push({ name: "SeekID", type: "b", data: new exports.Buffer([0x16, 0x54, 0xAE, 0x6B]) }); // Tracks
        seekHead.push({ name: "SeekPosition", type: "u", data: createUIntBuffer(tracksStart) });
        seekHead.push({ name: "Seek", type: "m", isEnd: true });
        seekHead.push({ name: "Seek", type: "m", isEnd: false });
        seekHead.push({ name: "SeekID", type: "b", data: new exports.Buffer([0x1C, 0x53, 0xBB, 0x6B]) }); // Cues
        seekHead.push({ name: "SeekPosition", type: "u", data: createUIntBuffer(cuesStart) });
        seekHead.push({ name: "Seek", type: "m", isEnd: true });
        seekHead.push({ name: "SeekHead", type: "m", isEnd: true });
        seekHeadSize = encodedSizeOfEbml(seekHead);
        //console.error("SeekHead size: " + seekHeadSize);
        //printElementIds(seekHead);  
        // create the Cues element
        cues = [];
        cues.push({ name: "Cues", type: "m", isEnd: false });
        cuesInfo.forEach(function (_a) {
            var CueTrack = _a.CueTrack, CueClusterPosition = _a.CueClusterPosition, CueTime = _a.CueTime;
            cues.push({ name: "CuePoint", type: "m", isEnd: false });
            cues.push({ name: "CueTime", type: "u", data: createUIntBuffer(CueTime) });
            cues.push({ name: "CueTrackPositions", type: "m", isEnd: false });
            cues.push({ name: "CueTrack", type: "u", data: createUIntBuffer(CueTrack) });
            //console.error(`CueClusterPosition: ${CueClusterPosition}, Corrected to: ${CueClusterPosition - segmentContentStartPos}  , offset by ${sizeDifference} to become ${(CueClusterPosition - segmentContentStartPos) + sizeDifference - segmentContentStartPos}`);
            // EBMLReader returns CueClusterPosition with absolute byte offsets. The Cues section expects them as offsets from the first level 1 element of the Segment, so we need to adjust it.
            CueClusterPosition -= segmentContentStartPos;
            // We also need to adjust to take into account the change in metadata size from when EBMLReader read the original metadata.
            CueClusterPosition += sizeDifference;
            cues.push({ name: "CueClusterPosition", type: "u", data: createUIntBuffer(CueClusterPosition) });
            cues.push({ name: "CueTrackPositions", type: "m", isEnd: true });
            cues.push({ name: "CuePoint", type: "m", isEnd: true });
        });
        cues.push({ name: "Cues", type: "m", isEnd: true });
        cuesSize = encodedSizeOfEbml(cues);
        //console.error("Cues size: " + cuesSize);   
        //console.error("Cue count: " + cuesInfo.length);
        //printElementIds(cues);      
        // If the new MetadataSize is not the same as the previous iteration, we need to run once more.
        if (lastSizeDifference !== sizeDifference) {
            lastSizeDifference = sizeDifference;
            if (i === maxIterations - 1) {
                throw new Error("Failed to converge to a stable metadata size");
            }
        }
        else {
            return "break";
        }
    };
    for (var i = 0; i < maxIterations; i++) {
        var state_1 = _loop_1(i);
        if (state_1 === "break")
            break;
    }
    var finalMetadata = [].concat.apply([], [
        header,
        { name: "Segment", type: "m", isEnd: false, unknownSize: true },
        seekHead,
        info,
        tracks,
        cues
    ]);
    var result = new EBMLEncoder_1.default().encode(finalMetadata);
    //printElementIds(finalMetadata);
    //console.error(`Final metadata buffer size: ${result.byteLength}`);
    //console.error(`Final metadata buffer size without header and segment: ${result.byteLength-segmentContentStartPos}`);
    return result;
}
exports.makeMetadataSeekable = makeMetadataSeekable;
/**
 * print all element id names in a list

 * @param metadata - array of EBML elements to print
 *
export function printElementIds(metadata: EBML.EBMLElementBuffer[]) {

  let result: EBML.EBMLElementBuffer[] = [];
  let start: number = -1;

  for (let i = 0; i < metadata.length; i++) {
    console.error("\t id: " + metadata[i].name);
  }
}
*/
/**
 * remove all occurances of an EBML element from an array of elements
 * If it's a MasterElement you will also remove the content. (everything between start and end)
 * @param idName - name of the EBML Element to remove.
 * @param metadata - array of EBML elements to search
 */
function removeElement(idName, metadata) {
    var result = [];
    var start = -1;
    for (var i = 0; i < metadata.length; i++) {
        var element = metadata[i];
        if (element.name === idName) {
            // if it's a Master element, extract the start and end element, and everything in between
            if (element.type === "m") {
                if (!element.isEnd) {
                    start = i;
                }
                else {
                    // we've reached the end, extract the whole thing
                    if (start == -1)
                        throw new Error("Detected " + idName + " closing element before finding the start");
                    metadata.splice(start, i - start + 1);
                    return;
                }
            }
            else {
                // not a Master element, so we've found what we're looking for.
                metadata.splice(i, 1);
                return;
            }
        }
    }
}
exports.removeElement = removeElement;
/**
 * extract the first occurance of an EBML tag from a flattened array of EBML data.
 * If it's a MasterElement you will also get the content. (everything between start and end)
 * @param idName - name of the EBML Element to extract.
 * @param metadata - array of EBML elements to search
 */
function extractElement(idName, metadata) {
    var result = [];
    var start = -1;
    for (var i = 0; i < metadata.length; i++) {
        var element = metadata[i];
        if (element.name === idName) {
            // if it's a Master element, extract the start and end element, and everything in between
            if (element.type === "m") {
                if (!element.isEnd) {
                    start = i;
                }
                else {
                    // we've reached the end, extract the whole thing
                    if (start == -1)
                        throw new Error("Detected " + idName + " closing element before finding the start");
                    result = metadata.slice(start, i + 1);
                    break;
                }
            }
            else {
                // not a Master element, so we've found what we're looking for.
                result.push(metadata[i]);
                break;
            }
        }
    }
    return result;
}
exports.extractElement = extractElement;
/**
 * @deprecated
 * metadata に対して duration と seekhead を追加した metadata を返す
 * @param metadata - 変更前の webm における ファイル先頭から 最初の Cluster 要素までの 要素
 * @param duration - Duration (TimecodeScale)
 * @param cues - cue points for clusters
 * @deprecated @param clusterPtrs - 変更前の webm における SeekHead に追加する Cluster 要素 への start pointer
 * @deprecated @param cueInfos - please use cues.
 */
function putRefinedMetaData(metadata, info) {
    if (Array.isArray(info.cueInfos) && !Array.isArray(info.cues)) {
        console.warn("putRefinedMetaData: info.cueInfos property is deprecated. please use info.cues");
        info.cues = info.cueInfos;
    }
    var ebml = [];
    var payload = [];
    for (var i_1 = 0; i_1 < metadata.length; i_1++) {
        var elm = metadata[i_1];
        if (elm.type === "m" && elm.name === "Segment") {
            ebml = metadata.slice(0, i_1);
            payload = metadata.slice(i_1);
            if (elm.unknownSize) {
                payload.shift(); // remove segment tag
                break;
            }
            throw new Error("this metadata is not streaming webm file");
        }
    }
    // *0    *4    *5  *36      *40   *48=segmentOffset              *185=originalPayloadOffsetEnd
    // |     |     |   |        |     |                              |
    // [EBML][size]....[Segment][size][Info][size][Duration][size]...[Cluster]
    // |               |        |^inf |                              |
    // |               +segmentSiz(12)+                              |
    // +-ebmlSize(36)--+        |     +-payloadSize(137)-------------+offsetEndDiff+
    //                 |        |     +-newPayloadSize(??)-------------------------+
    //                 |        |     |                                            |
    //                 [Segment][size][Info][size][Duration][size]....[size][value][Cluster]
    //                           ^                                                 |
    //                           |                                                 *??=newPayloadOffsetEnd
    //                           inf
    if (!(payload[payload.length - 1].dataEnd > 0)) {
        throw new Error("metadata dataEnd has wrong number");
    }
    var originalPayloadOffsetEnd = payload[payload.length - 1].dataEnd; // = first cluster ptr
    var ebmlSize = ebml[ebml.length - 1].dataEnd; // = first segment ptr
    var refinedEBMLSize = new EBMLEncoder_1.default().encode(ebml).byteLength;
    var offsetDiff = refinedEBMLSize - ebmlSize;
    var payloadSize = originalPayloadOffsetEnd - payload[0].tagStart;
    var segmentSize = payload[0].tagStart - ebmlSize;
    var segmentOffset = payload[0].tagStart;
    var segmentTagBuf = new exports.Buffer([0x18, 0x53, 0x80, 0x67]); // Segment
    var segmentSizeBuf = new exports.Buffer('01ffffffffffffff', 'hex'); // Segmentの最後の位置は無数の Cluster 依存なので。 writeVint(newPayloadSize).byteLength ではなく、 infinity.
    var _segmentSize = segmentTagBuf.byteLength + segmentSizeBuf.byteLength; // == segmentSize
    var newPayloadSize = payloadSize;
    // We need the size to be stable between two refinements in order for our offsets to be correct
    // Bound the number of possible refinements so we can't go infinate if something goes wrong
    var i;
    for (i = 1; i < 20; i++) {
        var newPayloadOffsetEnd = ebmlSize + _segmentSize + newPayloadSize;
        var offsetEndDiff = newPayloadOffsetEnd - originalPayloadOffsetEnd;
        var sizeDiff = offsetDiff + offsetEndDiff;
        var refined = refineMetadata(payload, sizeDiff, info);
        var newNewRefinedSize = new EBMLEncoder_1.default().encode(refined).byteLength; // 一旦 seekhead を作って自身のサイズを調べる
        if (newNewRefinedSize === newPayloadSize) {
            // Size is stable
            return new EBMLEncoder_1.default().encode([].concat(ebml, [{ type: "m", name: "Segment", isEnd: false, unknownSize: true }], refined));
        }
        newPayloadSize = newNewRefinedSize;
    }
    throw new Error("unable to refine metadata, stable size could not be found in " + i + " iterations!");
}
exports.putRefinedMetaData = putRefinedMetaData;
// Given a list of EBMLElementBuffers, returns their encoded size in bytes
function encodedSizeOfEbml(refinedMetaData) {
    var encorder = new EBMLEncoder_1.default();
    return refinedMetaData.reduce(function (lst, elm) { return lst.concat(encorder.encode([elm])); }, []).reduce(function (o, buf) { return o + buf.byteLength; }, 0);
}
function refineMetadata(mesetadata, sizeDiff, info) {
    var duration = info.duration, clusterPtrs = info.clusterPtrs, cues = info.cues;
    var _metadata = mesetadata.slice(0);
    if (typeof duration === "number") {
        // duration を追加する
        var overwrited_1 = false;
        _metadata.forEach(function (elm) {
            if (elm.type === "f" && elm.name === "Duration") {
                overwrited_1 = true;
                elm.data = createFloatBuffer(duration, 8);
            }
        });
        if (!overwrited_1) {
            insertTag(_metadata, "Info", [{ name: "Duration", type: "f", data: createFloatBuffer(duration, 8) }]);
        }
    }
    if (Array.isArray(cues)) {
        insertTag(_metadata, "Cues", create_cue(cues, sizeDiff));
    }
    var seekhead_children = [];
    if (Array.isArray(clusterPtrs)) {
        console.warn("append cluster pointers to seekhead is deprecated. please use cues");
        seekhead_children = create_seek_from_clusters(clusterPtrs, sizeDiff);
    }
    // remove seek info
    /*
    _metadata = _metadata.filter((elm)=> !(
      elm.name === "Seek" ||
      elm.name === "SeekID" ||
      elm.name === "SeekPosition") );
    */
    // working on progress
    //seekhead_children = seekhead_children.concat(create_seekhead(_metadata));
    insertTag(_metadata, "SeekHead", seekhead_children, true);
    return _metadata;
}
function create_seekhead(metadata, sizeDiff) {
    var seeks = [];
    ["Info", "Tracks", "Cues"].forEach(function (tagName) {
        var tagStarts = metadata.filter(function (elm) { return elm.type === "m" && elm.name === tagName && elm.isEnd === false; }).map(function (elm) { return elm["tagStart"]; });
        var tagStart = tagStarts[0];
        if (typeof tagStart !== "number") {
            return;
        }
        seeks.push({ name: "Seek", type: "m", isEnd: false });
        switch (tagName) {
            case "Info":
                seeks.push({ name: "SeekID", type: "b", data: new exports.Buffer([0x15, 0x49, 0xA9, 0x66]) });
                break;
            case "Tracks":
                seeks.push({ name: "SeekID", type: "b", data: new exports.Buffer([0x16, 0x54, 0xAE, 0x6B]) });
                break;
            case "Cues":
                seeks.push({ name: "SeekID", type: "b", data: new exports.Buffer([0x1C, 0x53, 0xBB, 0x6B]) });
                break;
        }
        seeks.push({ name: "SeekPosition", type: "u", data: createUIntBuffer(tagStart + sizeDiff) });
        seeks.push({ name: "Seek", type: "m", isEnd: true });
    });
    return seeks;
}
function create_seek_from_clusters(clusterPtrs, sizeDiff) {
    var seeks = [];
    clusterPtrs.forEach(function (start) {
        seeks.push({ name: "Seek", type: "m", isEnd: false });
        // [0x1F, 0x43, 0xB6, 0x75] で Cluster 意
        seeks.push({ name: "SeekID", type: "b", data: new exports.Buffer([0x1F, 0x43, 0xB6, 0x75]) });
        seeks.push({ name: "SeekPosition", type: "u", data: createUIntBuffer(start + sizeDiff) });
        seeks.push({ name: "Seek", type: "m", isEnd: true });
    });
    return seeks;
}
function create_cue(cueInfos, sizeDiff) {
    var cues = [];
    cueInfos.forEach(function (_a) {
        var CueTrack = _a.CueTrack, CueClusterPosition = _a.CueClusterPosition, CueTime = _a.CueTime;
        cues.push({ name: "CuePoint", type: "m", isEnd: false });
        cues.push({ name: "CueTime", type: "u", data: createUIntBuffer(CueTime) });
        cues.push({ name: "CueTrackPositions", type: "m", isEnd: false });
        cues.push({ name: "CueTrack", type: "u", data: createUIntBuffer(CueTrack) }); // video track
        cues.push({ name: "CueClusterPosition", type: "u", data: createUIntBuffer(CueClusterPosition + sizeDiff) });
        cues.push({ name: "CueTrackPositions", type: "m", isEnd: true });
        cues.push({ name: "CuePoint", type: "m", isEnd: true });
    });
    return cues;
}
function insertTag(_metadata, tagName, children, insertHead) {
    if (insertHead === void 0) { insertHead = false; }
    // find the tagname from _metadata
    var idx = -1;
    for (var i = 0; i < _metadata.length; i++) {
        var elm = _metadata[i];
        if (elm.type === "m" && elm.name === tagName && elm.isEnd === false) {
            idx = i;
            break;
        }
    }
    if (idx >= 0) {
        // insert [<CuePoint />] to <Cues />
        Array.prototype.splice.apply(_metadata, [idx + 1, 0].concat(children));
    }
    else if (insertHead) {
        [].concat([{ name: tagName, type: "m", isEnd: false }], children, [{ name: tagName, type: "m", isEnd: true }]).reverse().forEach(function (elm) { _metadata.unshift(elm); });
    }
    else {
        // metadata 末尾に <Cues /> を追加
        // insert <Cues />
        _metadata.push({ name: tagName, type: "m", isEnd: false });
        children.forEach(function (elm) { _metadata.push(elm); });
        _metadata.push({ name: tagName, type: "m", isEnd: true });
    }
}
// alter Buffer.concat - https://github.com/feross/buffer/issues/154
function concat(list) {
    //return Buffer.concat.apply(Buffer, list);
    var i = 0;
    var length = 0;
    for (; i < list.length; ++i) {
        length += list[i].length;
    }
    var buffer = exports.Buffer.allocUnsafe(length);
    var pos = 0;
    for (i = 0; i < list.length; ++i) {
        var buf = list[i];
        buf.copy(buffer, pos);
        pos += buf.length;
    }
    return buffer;
}
exports.concat = concat;
function encodeValueToBuffer(elm) {
    var data = new exports.Buffer(0);
    if (elm.type === "m") {
        return elm;
    }
    switch (elm.type) {
        case "u":
            data = createUIntBuffer(elm.value);
            break;
        case "i":
            data = createIntBuffer(elm.value);
            break;
        case "f":
            data = createFloatBuffer(elm.value);
            break;
        case "s":
            data = new exports.Buffer(elm.value, 'ascii');
            break;
        case "8":
            data = new exports.Buffer(elm.value, 'utf8');
            break;
        case "b":
            data = elm.value;
            break;
        case "d":
            data = new int64_buffer_1.Int64BE(elm.value.getTime().toString()).toBuffer();
            break;
    }
    return Object.assign({}, elm, { data: data });
}
exports.encodeValueToBuffer = encodeValueToBuffer;
function createUIntBuffer(value) {
    // Big-endian, any size from 1 to 8
    // but js number is float64, so max 6 bit octets
    var bytes = 1;
    for (; value >= Math.pow(2, 8 * bytes); bytes++) { }
    if (bytes >= 7) {
        console.warn("7bit or more bigger uint not supported.");
        return new int64_buffer_1.Uint64BE(value).toBuffer();
    }
    var data = new exports.Buffer(bytes);
    data.writeUIntBE(value, 0, bytes);
    return data;
}
exports.createUIntBuffer = createUIntBuffer;
function createIntBuffer(value) {
    // Big-endian, any size from 1 to 8 octets
    // but js number is float64, so max 6 bit
    var bytes = 1;
    for (; value >= Math.pow(2, 8 * bytes); bytes++) { }
    if (bytes >= 7) {
        console.warn("7bit or more bigger uint not supported.");
        return new int64_buffer_1.Int64BE(value).toBuffer();
    }
    var data = new exports.Buffer(bytes);
    data.writeIntBE(value, 0, bytes);
    return data;
}
exports.createIntBuffer = createIntBuffer;
function createFloatBuffer(value, bytes) {
    if (bytes === void 0) { bytes = 8; }
    // Big-endian, defined for 4 and 8 octets (32, 64 bits)
    // js number is float64 so 8 bytes.
    if (bytes === 8) {
        // 64bit
        var data = new exports.Buffer(8);
        data.writeDoubleBE(value, 0);
        return data;
    }
    else if (bytes === 4) {
        // 32bit
        var data = new exports.Buffer(4);
        data.writeFloatBE(value, 0);
        return data;
    }
    else {
        throw new Error("float type bits must 4bytes or 8bytes");
    }
}
exports.createFloatBuffer = createFloatBuffer;
function convertEBMLDateToJSDate(int64str) {
    if (int64str instanceof Date) {
        return int64str;
    }
    return new Date(new Date("2001-01-01T00:00:00.000Z").getTime() + (Number(int64str) / 1000 / 1000));
}
exports.convertEBMLDateToJSDate = convertEBMLDateToJSDate;

},{"./EBMLEncoder":2,"buffer/":9,"ebml":17,"ebml-block":14,"int64-buffer":25}],7:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function getLens (b64) {
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // Trim off extra bytes after placeholder bytes are found
  // See: https://github.com/beatgammit/base64-js/issues/42
  var validLen = b64.indexOf('=')
  if (validLen === -1) validLen = len

  var placeHoldersLen = validLen === len
    ? 0
    : 4 - (validLen % 4)

  return [validLen, placeHoldersLen]
}

// base64 is 4/3 + up to two characters of the original data
function byteLength (b64) {
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function _byteLength (b64, validLen, placeHoldersLen) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function toByteArray (b64) {
  var tmp
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]

  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

  var curByte = 0

  // if there are placeholders, only get up to the last complete 4 chars
  var len = placeHoldersLen > 0
    ? validLen - 4
    : validLen

  var i
  for (i = 0; i < len; i += 4) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 18) |
      (revLookup[b64.charCodeAt(i + 1)] << 12) |
      (revLookup[b64.charCodeAt(i + 2)] << 6) |
      revLookup[b64.charCodeAt(i + 3)]
    arr[curByte++] = (tmp >> 16) & 0xFF
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 2) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 2) |
      (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 1) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 10) |
      (revLookup[b64.charCodeAt(i + 1)] << 4) |
      (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(
      uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)
    ))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    )
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1]
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    )
  }

  return parts.join('')
}

},{}],8:[function(require,module,exports){

},{}],9:[function(require,module,exports){
(function (Buffer){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var customInspectSymbol =
  (typeof Symbol === 'function' && typeof Symbol.for === 'function')
    ? Symbol.for('nodejs.util.inspect.custom')
    : null

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    var proto = { foo: function () { return 42 } }
    Object.setPrototypeOf(proto, Uint8Array.prototype)
    Object.setPrototypeOf(arr, proto)
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  Object.setPrototypeOf(buf, Buffer.prototype)
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value)
  }

  if (value == null) {
    throw new TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }

  if (isInstance(value, ArrayBuffer) ||
      (value && isInstance(value.buffer, ArrayBuffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof SharedArrayBuffer !== 'undefined' &&
      (isInstance(value, SharedArrayBuffer) ||
      (value && isInstance(value.buffer, SharedArrayBuffer)))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'number') {
    throw new TypeError(
      'The "value" argument must not be of type number. Received type number'
    )
  }

  var valueOf = value.valueOf && value.valueOf()
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length)
  }

  var b = fromObject(value)
  if (b) return b

  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
      typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(
      value[Symbol.toPrimitive]('string'), encodingOrOffset, length
    )
  }

  throw new TypeError(
    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
    'or Array-like Object. Received type ' + (typeof value)
  )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Object.setPrototypeOf(Buffer.prototype, Uint8Array.prototype)
Object.setPrototypeOf(Buffer, Uint8Array)

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  Object.setPrototypeOf(buf, Buffer.prototype)

  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0)
    }
    return fromArrayLike(obj)
  }

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data)
  }
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true &&
    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    )
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
      'Received type ' + typeof string
    )
  }

  var len = string.length
  var mustMatch = (arguments.length > 2 && arguments[2] === true)
  if (!mustMatch && len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
        }
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
  if (this.length > max) str += ' ... '
  return '<Buffer ' + str + '>'
}
if (customInspectSymbol) {
  Buffer.prototype[customInspectSymbol] = Buffer.prototype.inspect
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength)
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError(
      'The "target" argument must be one of type Buffer or Uint8Array. ' +
      'Received type ' + (typeof target)
    )
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [val], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
        : (firstByte > 0xBF) ? 2
          : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += hexSliceLookupTable[buf[i]]
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  Object.setPrototypeOf(newBuf, Buffer.prototype)

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  } else if (typeof val === 'boolean') {
    val = Number(val)
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
function isInstance (obj, type) {
  return obj instanceof type ||
    (obj != null && obj.constructor != null && obj.constructor.name != null &&
      obj.constructor.name === type.name)
}
function numberIsNaN (obj) {
  // For IE11 support
  return obj !== obj // eslint-disable-line no-self-compare
}

// Create lookup table for `toString('hex')`
// See: https://github.com/feross/buffer/issues/219
var hexSliceLookupTable = (function () {
  var alphabet = '0123456789abcdef'
  var table = new Array(256)
  for (var i = 0; i < 16; ++i) {
    var i16 = i * 16
    for (var j = 0; j < 16; ++j) {
      table[i16 + j] = alphabet[i] + alphabet[j]
    }
  }
  return table
})()

}).call(this,require("buffer").Buffer)
},{"base64-js":7,"buffer":53,"ieee754":23}],10:[function(require,module,exports){
(function (Buffer){
module.exports = Buffers;

function Buffers (bufs) {
    if (!(this instanceof Buffers)) return new Buffers(bufs);
    this.buffers = bufs || [];
    this.length = this.buffers.reduce(function (size, buf) {
        return size + buf.length
    }, 0);
}

Buffers.prototype.push = function () {
    for (var i = 0; i < arguments.length; i++) {
        if (!Buffer.isBuffer(arguments[i])) {
            throw new TypeError('Tried to push a non-buffer');
        }
    }
    
    for (var i = 0; i < arguments.length; i++) {
        var buf = arguments[i];
        this.buffers.push(buf);
        this.length += buf.length;
    }
    return this.length;
};

Buffers.prototype.unshift = function () {
    for (var i = 0; i < arguments.length; i++) {
        if (!Buffer.isBuffer(arguments[i])) {
            throw new TypeError('Tried to unshift a non-buffer');
        }
    }
    
    for (var i = 0; i < arguments.length; i++) {
        var buf = arguments[i];
        this.buffers.unshift(buf);
        this.length += buf.length;
    }
    return this.length;
};

Buffers.prototype.copy = function (dst, dStart, start, end) {
    return this.slice(start, end).copy(dst, dStart, 0, end - start);
};

Buffers.prototype.splice = function (i, howMany) {
    var buffers = this.buffers;
    var index = i >= 0 ? i : this.length - i;
    var reps = [].slice.call(arguments, 2);
    
    if (howMany === undefined) {
        howMany = this.length - index;
    }
    else if (howMany > this.length - index) {
        howMany = this.length - index;
    }
    
    for (var i = 0; i < reps.length; i++) {
        this.length += reps[i].length;
    }
    
    var removed = new Buffers();
    var bytes = 0;
    
    var startBytes = 0;
    for (
        var ii = 0;
        ii < buffers.length && startBytes + buffers[ii].length < index;
        ii ++
    ) { startBytes += buffers[ii].length }
    
    if (index - startBytes > 0) {
        var start = index - startBytes;
        
        if (start + howMany < buffers[ii].length) {
            removed.push(buffers[ii].slice(start, start + howMany));
            
            var orig = buffers[ii];
            //var buf = new Buffer(orig.length - howMany);
            var buf0 = new Buffer(start);
            for (var i = 0; i < start; i++) {
                buf0[i] = orig[i];
            }
            
            var buf1 = new Buffer(orig.length - start - howMany);
            for (var i = start + howMany; i < orig.length; i++) {
                buf1[ i - howMany - start ] = orig[i]
            }
            
            if (reps.length > 0) {
                var reps_ = reps.slice();
                reps_.unshift(buf0);
                reps_.push(buf1);
                buffers.splice.apply(buffers, [ ii, 1 ].concat(reps_));
                ii += reps_.length;
                reps = [];
            }
            else {
                buffers.splice(ii, 1, buf0, buf1);
                //buffers[ii] = buf;
                ii += 2;
            }
        }
        else {
            removed.push(buffers[ii].slice(start));
            buffers[ii] = buffers[ii].slice(0, start);
            ii ++;
        }
    }
    
    if (reps.length > 0) {
        buffers.splice.apply(buffers, [ ii, 0 ].concat(reps));
        ii += reps.length;
    }
    
    while (removed.length < howMany) {
        var buf = buffers[ii];
        var len = buf.length;
        var take = Math.min(len, howMany - removed.length);
        
        if (take === len) {
            removed.push(buf);
            buffers.splice(ii, 1);
        }
        else {
            removed.push(buf.slice(0, take));
            buffers[ii] = buffers[ii].slice(take);
        }
    }
    
    this.length -= removed.length;
    
    return removed;
};
 
Buffers.prototype.slice = function (i, j) {
    var buffers = this.buffers;
    if (j === undefined) j = this.length;
    if (i === undefined) i = 0;
    
    if (j > this.length) j = this.length;
    
    var startBytes = 0;
    for (
        var si = 0;
        si < buffers.length && startBytes + buffers[si].length <= i;
        si ++
    ) { startBytes += buffers[si].length }
    
    var target = new Buffer(j - i);
    
    var ti = 0;
    for (var ii = si; ti < j - i && ii < buffers.length; ii++) {
        var len = buffers[ii].length;
        
        var start = ti === 0 ? i - startBytes : 0;
        var end = ti + len >= j - i
            ? Math.min(start + (j - i) - ti, len)
            : len
        ;
        
        buffers[ii].copy(target, ti, start, end);
        ti += end - start;
    }
    
    return target;
};

Buffers.prototype.pos = function (i) {
    if (i < 0 || i >= this.length) throw new Error('oob');
    var l = i, bi = 0, bu = null;
    for (;;) {
        bu = this.buffers[bi];
        if (l < bu.length) {
            return {buf: bi, offset: l};
        } else {
            l -= bu.length;
        }
        bi++;
    }
};

Buffers.prototype.get = function get (i) {
    var pos = this.pos(i);

    return this.buffers[pos.buf].get(pos.offset);
};

Buffers.prototype.set = function set (i, b) {
    var pos = this.pos(i);

    return this.buffers[pos.buf].set(pos.offset, b);
};

Buffers.prototype.indexOf = function (needle, offset) {
    if ("string" === typeof needle) {
        needle = new Buffer(needle);
    } else if (needle instanceof Buffer) {
        // already a buffer
    } else {
        throw new Error('Invalid type for a search string');
    }

    if (!needle.length) {
        return 0;
    }

    if (!this.length) {
        return -1;
    }

    var i = 0, j = 0, match = 0, mstart, pos = 0;

    // start search from a particular point in the virtual buffer
    if (offset) {
        var p = this.pos(offset);
        i = p.buf;
        j = p.offset;
        pos = offset;
    }

    // for each character in virtual buffer
    for (;;) {
        while (j >= this.buffers[i].length) {
            j = 0;
            i++;

            if (i >= this.buffers.length) {
                // search string not found
                return -1;
            }
        }

        var char = this.buffers[i][j];

        if (char == needle[match]) {
            // keep track where match started
            if (match == 0) {
                mstart = {
                    i: i,
                    j: j,
                    pos: pos
                };
            }
            match++;
            if (match == needle.length) {
                // full match
                return mstart.pos;
            }
        } else if (match != 0) {
            // a partial match ended, go back to match starting position
            // this will continue the search at the next character
            i = mstart.i;
            j = mstart.j;
            pos = mstart.pos;
            match = 0;
        }

        j++;
        pos++;
    }
};

Buffers.prototype.toBuffer = function() {
    return this.slice();
}

Buffers.prototype.toString = function(encoding, start, end) {
    return this.slice(start, end).toString(encoding);
}

}).call(this,require("buffer").Buffer)
},{"buffer":53}],11:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.

function isArray(arg) {
  if (Array.isArray) {
    return Array.isArray(arg);
  }
  return objectToString(arg) === '[object Array]';
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = Buffer.isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

}).call(this,{"isBuffer":require("../../is-buffer/index.js")})
},{"../../is-buffer/index.js":26}],12:[function(require,module,exports){
(function (process){
/**
 * This is the web browser implementation of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = require('./debug');
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.storage = 'undefined' != typeof chrome
               && 'undefined' != typeof chrome.storage
                  ? chrome.storage.local
                  : localstorage();

/**
 * Colors.
 */

exports.colors = [
  '#0000CC', '#0000FF', '#0033CC', '#0033FF', '#0066CC', '#0066FF', '#0099CC',
  '#0099FF', '#00CC00', '#00CC33', '#00CC66', '#00CC99', '#00CCCC', '#00CCFF',
  '#3300CC', '#3300FF', '#3333CC', '#3333FF', '#3366CC', '#3366FF', '#3399CC',
  '#3399FF', '#33CC00', '#33CC33', '#33CC66', '#33CC99', '#33CCCC', '#33CCFF',
  '#6600CC', '#6600FF', '#6633CC', '#6633FF', '#66CC00', '#66CC33', '#9900CC',
  '#9900FF', '#9933CC', '#9933FF', '#99CC00', '#99CC33', '#CC0000', '#CC0033',
  '#CC0066', '#CC0099', '#CC00CC', '#CC00FF', '#CC3300', '#CC3333', '#CC3366',
  '#CC3399', '#CC33CC', '#CC33FF', '#CC6600', '#CC6633', '#CC9900', '#CC9933',
  '#CCCC00', '#CCCC33', '#FF0000', '#FF0033', '#FF0066', '#FF0099', '#FF00CC',
  '#FF00FF', '#FF3300', '#FF3333', '#FF3366', '#FF3399', '#FF33CC', '#FF33FF',
  '#FF6600', '#FF6633', '#FF9900', '#FF9933', '#FFCC00', '#FFCC33'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

function useColors() {
  // NB: In an Electron preload script, document will be defined but not fully
  // initialized. Since we know we're in Chrome, we'll just detect this case
  // explicitly
  if (typeof window !== 'undefined' && window.process && window.process.type === 'renderer') {
    return true;
  }

  // Internet Explorer and Edge do not support colors.
  if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
    return false;
  }

  // is webkit? http://stackoverflow.com/a/16459606/376773
  // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
  return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
    // is firebug? http://stackoverflow.com/a/398120/376773
    (typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
    // is firefox >= v31?
    // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
    // double check webkit in userAgent just in case we are in a worker
    (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
}

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

exports.formatters.j = function(v) {
  try {
    return JSON.stringify(v);
  } catch (err) {
    return '[UnexpectedJSONParseError]: ' + err.message;
  }
};


/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs(args) {
  var useColors = this.useColors;

  args[0] = (useColors ? '%c' : '')
    + this.namespace
    + (useColors ? ' %c' : ' ')
    + args[0]
    + (useColors ? '%c ' : ' ')
    + '+' + exports.humanize(this.diff);

  if (!useColors) return;

  var c = 'color: ' + this.color;
  args.splice(1, 0, c, 'color: inherit')

  // the final "%c" is somewhat tricky, because there could be other
  // arguments passed either before or after the %c, so we need to
  // figure out the correct index to insert the CSS into
  var index = 0;
  var lastC = 0;
  args[0].replace(/%[a-zA-Z%]/g, function(match) {
    if ('%%' === match) return;
    index++;
    if ('%c' === match) {
      // we only are interested in the *last* %c
      // (the user may have provided their own)
      lastC = index;
    }
  });

  args.splice(lastC, 0, c);
}

/**
 * Invokes `console.log()` when available.
 * No-op when `console.log` is not a "function".
 *
 * @api public
 */

function log() {
  // this hackery is required for IE8/9, where
  // the `console.log` function doesn't have 'apply'
  return 'object' === typeof console
    && console.log
    && Function.prototype.apply.call(console.log, console, arguments);
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */

function save(namespaces) {
  try {
    if (null == namespaces) {
      exports.storage.removeItem('debug');
    } else {
      exports.storage.debug = namespaces;
    }
  } catch(e) {}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
  var r;
  try {
    r = exports.storage.debug;
  } catch(e) {}

  // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
  if (!r && typeof process !== 'undefined' && 'env' in process) {
    r = process.env.DEBUG;
  }

  return r;
}

/**
 * Enable namespaces listed in `localStorage.debug` initially.
 */

exports.enable(load());

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage() {
  try {
    return window.localStorage;
  } catch (e) {}
}

}).call(this,require('_process'))
},{"./debug":13,"_process":31}],13:[function(require,module,exports){

/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = createDebug.debug = createDebug['default'] = createDebug;
exports.coerce = coerce;
exports.disable = disable;
exports.enable = enable;
exports.enabled = enabled;
exports.humanize = require('ms');

/**
 * Active `debug` instances.
 */
exports.instances = [];

/**
 * The currently active debug mode names, and names to skip.
 */

exports.names = [];
exports.skips = [];

/**
 * Map of special "%n" handling functions, for the debug "format" argument.
 *
 * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
 */

exports.formatters = {};

/**
 * Select a color.
 * @param {String} namespace
 * @return {Number}
 * @api private
 */

function selectColor(namespace) {
  var hash = 0, i;

  for (i in namespace) {
    hash  = ((hash << 5) - hash) + namespace.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  return exports.colors[Math.abs(hash) % exports.colors.length];
}

/**
 * Create a debugger with the given `namespace`.
 *
 * @param {String} namespace
 * @return {Function}
 * @api public
 */

function createDebug(namespace) {

  var prevTime;

  function debug() {
    // disabled?
    if (!debug.enabled) return;

    var self = debug;

    // set `diff` timestamp
    var curr = +new Date();
    var ms = curr - (prevTime || curr);
    self.diff = ms;
    self.prev = prevTime;
    self.curr = curr;
    prevTime = curr;

    // turn the `arguments` into a proper Array
    var args = new Array(arguments.length);
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i];
    }

    args[0] = exports.coerce(args[0]);

    if ('string' !== typeof args[0]) {
      // anything else let's inspect with %O
      args.unshift('%O');
    }

    // apply any `formatters` transformations
    var index = 0;
    args[0] = args[0].replace(/%([a-zA-Z%])/g, function(match, format) {
      // if we encounter an escaped % then don't increase the array index
      if (match === '%%') return match;
      index++;
      var formatter = exports.formatters[format];
      if ('function' === typeof formatter) {
        var val = args[index];
        match = formatter.call(self, val);

        // now we need to remove `args[index]` since it's inlined in the `format`
        args.splice(index, 1);
        index--;
      }
      return match;
    });

    // apply env-specific formatting (colors, etc.)
    exports.formatArgs.call(self, args);

    var logFn = debug.log || exports.log || console.log.bind(console);
    logFn.apply(self, args);
  }

  debug.namespace = namespace;
  debug.enabled = exports.enabled(namespace);
  debug.useColors = exports.useColors();
  debug.color = selectColor(namespace);
  debug.destroy = destroy;

  // env-specific initialization logic for debug instances
  if ('function' === typeof exports.init) {
    exports.init(debug);
  }

  exports.instances.push(debug);

  return debug;
}

function destroy () {
  var index = exports.instances.indexOf(this);
  if (index !== -1) {
    exports.instances.splice(index, 1);
    return true;
  } else {
    return false;
  }
}

/**
 * Enables a debug mode by namespaces. This can include modes
 * separated by a colon and wildcards.
 *
 * @param {String} namespaces
 * @api public
 */

function enable(namespaces) {
  exports.save(namespaces);

  exports.names = [];
  exports.skips = [];

  var i;
  var split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
  var len = split.length;

  for (i = 0; i < len; i++) {
    if (!split[i]) continue; // ignore empty strings
    namespaces = split[i].replace(/\*/g, '.*?');
    if (namespaces[0] === '-') {
      exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    } else {
      exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }

  for (i = 0; i < exports.instances.length; i++) {
    var instance = exports.instances[i];
    instance.enabled = exports.enabled(instance.namespace);
  }
}

/**
 * Disable debug output.
 *
 * @api public
 */

function disable() {
  exports.enable('');
}

/**
 * Returns true if the given mode name is enabled, false otherwise.
 *
 * @param {String} name
 * @return {Boolean}
 * @api public
 */

function enabled(name) {
  if (name[name.length - 1] === '*') {
    return true;
  }
  var i, len;
  for (i = 0, len = exports.skips.length; i < len; i++) {
    if (exports.skips[i].test(name)) {
      return false;
    }
  }
  for (i = 0, len = exports.names.length; i < len; i++) {
    if (exports.names[i].test(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Coerce `val`.
 *
 * @param {Mixed} val
 * @return {Mixed}
 * @api private
 */

function coerce(val) {
  if (val instanceof Error) return val.stack || val.message;
  return val;
}

},{"ms":29}],14:[function(require,module,exports){
var BufferReader = require('./lib/buffer-reader')

var XIPH_LACING = 1
var EBML_LACING = 3
var FIXED_SIZE_LACING = 2

module.exports = function (buffer) {
  var block = {}
  var reader = new BufferReader(buffer)

  block.trackNumber = reader.nextUIntV()
  block.timecode = reader.nextInt16BE()

  var flags = reader.nextUInt8()

  block.invisible = !!(flags & 0x8)

  // only valid for SimpleBlock
  block.keyframe = !!(flags & 0x80)
  block.discardable = !!(flags & 0x1)

  var lacing = (flags & 0x6) >> 1

  block.frames = readLacedData(reader, lacing)

  return block
}

function readLacedData (reader, lacing) {
  if (!lacing) return [reader.nextBuffer()]

  var i, frameSize
  var frames = []
  var framesNum = reader.nextUInt8() + 1 // number of frames

  if (lacing === FIXED_SIZE_LACING) {
    // remaining data should be divisible by the number of frames
    if (reader.length % framesNum !== 0) throw new Error('Fixed-Size Lacing Error')

    frameSize = reader.length / framesNum
    for (i = 0; i < framesNum; i++) {
      frames.push(reader.nextBuffer(frameSize))
    }
    return frames
  }

  var frameSizes = []

  if (lacing === XIPH_LACING) {
    for (i = 0; i < framesNum - 1; i++) {
      var val
      frameSize = 0
      do {
        val = reader.nextUInt8()
        frameSize += val
      } while (val === 0xff)
      frameSizes.push(frameSize)
    }
  } else if (lacing === EBML_LACING) {
    // first frame
    frameSize = reader.nextUIntV()
    frameSizes.push(frameSize)

    // middle frames
    for (i = 1; i < framesNum - 1; i++) {
      frameSize += reader.nextIntV()
      frameSizes.push(frameSize)
    }
  }

  for (i = 0; i < framesNum - 1; i++) {
    frames.push(reader.nextBuffer(frameSizes[i]))
  }

  // last frame (remaining buffer)
  frames.push(reader.nextBuffer())

  return frames
}

},{"./lib/buffer-reader":15}],15:[function(require,module,exports){
var vint = require('./vint')

function BufferReader (buffer) {
  this.buffer = buffer
  this.offset = 0
}

// a super limited subset of the node buffer API
BufferReader.prototype.nextInt16BE = function () {
  var value = this.buffer.readInt16BE(this.offset)
  this.offset += 2
  return value
}

BufferReader.prototype.nextUInt8 = function () {
  var value = this.buffer.readUInt8(this.offset)
  this.offset += 1
  return value
}

// EBML variable sized integers
BufferReader.prototype.nextUIntV = function () {
  var v = vint(this.buffer, this.offset)
  this.offset += v.length
  return v.value
}

BufferReader.prototype.nextIntV = function () {
  var v = vint(this.buffer, this.offset, true)
  this.offset += v.length
  return v.value
}

// buffer slice
BufferReader.prototype.nextBuffer = function (length) {
  var buffer = length
    ? this.buffer.slice(this.offset, this.offset + length)
    : this.buffer.slice(this.offset)
  this.offset += length || this.length
  return buffer
}

// remaining bytes to read
Object.defineProperty(BufferReader.prototype, 'length', {
  get: function () { return this.buffer.length - this.offset }
})

module.exports = BufferReader

},{"./vint":16}],16:[function(require,module,exports){
// https://github.com/themasch/node-ebml/blob/master/lib/ebml/tools.js
module.exports = function (buffer, start, signed) {
  start = start || 0
  for (var length = 1; length <= 8; length++) {
    if (buffer[start] >= Math.pow(2, 8 - length)) {
      break
    }
  }
  if (length > 8) {
    throw new Error('Unrepresentable length: ' + length + ' ' +
      buffer.toString('hex', start, start + length))
  }
  if (start + length > buffer.length) {
    return null
  }
  var i
  var value = buffer[start] & (1 << (8 - length)) - 1
  for (i = 1; i < length; i++) {
    if (i === 7) {
      if (value >= Math.pow(2, 53 - 8) && buffer[start + 7] > 0) {
        return {
          length: length,
          value: -1
        }
      }
    }
    value *= Math.pow(2, 8)
    value += buffer[start + i]
  }
  if (signed) {
    value -= Math.pow(2, length * 7 - 1) - 1
  }
  return {
    length: length,
    value: value
  }
}

},{}],17:[function(require,module,exports){
module.exports = require('./lib/ebml/index.js');

},{"./lib/ebml/index.js":20}],18:[function(require,module,exports){
(function (Buffer){
var Transform = require('stream').Transform,
    tools = require('./tools.js'),
    schema = require('./schema.js'),
    debug = require('debug')('ebml:decoder');

var STATE_TAG = 1,
    STATE_SIZE = 2,
    STATE_CONTENT = 3;


function EbmlDecoder(options) {
    options = options || {};
    options.readableObjectMode = true;
    Transform.call(this, options);

    this._buffer = null;
    this._tag_stack = [];
    this._state = STATE_TAG;
    this._cursor = 0;
    this._total = 0;
    this._schema = schema;
}

require('util').inherits(EbmlDecoder, Transform);

EbmlDecoder.prototype._transform = function(chunk, enc, done) {

    if (this._buffer === null) {
        this._buffer = chunk;
    } else {
        this._buffer = Buffer.concat([this._buffer, chunk]);
    }

    while (this._cursor < this._buffer.length) {
        if (this._state === STATE_TAG && !this.readTag()) {
            break;
        }
        if (this._state === STATE_SIZE && !this.readSize()) {
            break;
        }
        if (this._state === STATE_CONTENT && !this.readContent()) {
            break;
        }
    }

    done();
};

EbmlDecoder.prototype.getSchemaInfo = function(tagStr) {
    return this._schema[tagStr] || {
        "type": "unknown",
        "name": "unknown"
    };
};

EbmlDecoder.prototype.readTag = function() {

    debug('parsing tag');

    if (this._cursor >= this._buffer.length) {
        debug('waiting for more data');
        return false;
    }

    var start = this._total;
    var tag = tools.readVint(this._buffer, this._cursor);

    if (tag == null) {
        debug('waiting for more data');
        return false;
    }

    var tagStr = this._buffer.toString('hex', this._cursor, this._cursor + tag.length);

    this._cursor += tag.length;
    this._total += tag.length;
    this._state = STATE_SIZE;

    var tagObj = {
        tag: tag.value,
        tagStr: tagStr,
        type: this.getSchemaInfo(tagStr).type,
        name: this.getSchemaInfo(tagStr).name,
        start: start,
        end: start + tag.length
    };

    this._tag_stack.push(tagObj);
    debug('read tag: ' + tagStr);

    return true;
};

EbmlDecoder.prototype.readSize = function() {

    var tagObj = this._tag_stack[this._tag_stack.length - 1];

    debug('parsing size for tag: ' + tagObj.tag.toString(16));

    if (this._cursor >= this._buffer.length) {
        debug('waiting for more data');
        return false;
    }


    var size = tools.readVint(this._buffer, this._cursor);

    if (size == null) {
        debug('waiting for more data');
        return false;
    }

    this._cursor += size.length;
    this._total += size.length;
    this._state = STATE_CONTENT;
    tagObj.dataSize = size.value;

    // unknown size
    if (size.value === -1) {
        tagObj.end = -1;
    } else {
        tagObj.end += size.value + size.length;
    }

    debug('read size: ' + size.value);

    return true;
};

EbmlDecoder.prototype.readContent = function() {

    var tagObj = this._tag_stack[this._tag_stack.length - 1];

    debug('parsing content for tag: ' + tagObj.tag.toString(16));

    if (tagObj.type === 'm') {
        debug('content should be tags');
        this.push(['start', tagObj]);
        this._state = STATE_TAG;
        return true;
    }

    if (this._buffer.length < this._cursor + tagObj.dataSize) {
        debug('got: ' + this._buffer.length);
        debug('need: ' + (this._cursor + tagObj.dataSize));
        debug('waiting for more data');
        return false;
    }

    var data = this._buffer.slice(this._cursor, this._cursor + tagObj.dataSize);
    this._total += tagObj.dataSize;
    this._state = STATE_TAG;
    this._buffer = this._buffer.slice(this._cursor + tagObj.dataSize);
    this._cursor = 0;

    this._tag_stack.pop(); // remove the object from the stack

    tagObj.data = data;
    this.push(['tag', tagObj]);

    while (this._tag_stack.length > 0) {
        var topEle = this._tag_stack[this._tag_stack.length - 1];
        if (this._total < topEle.end) {
            break;
        }
        this.push(['end', topEle]);
        this._tag_stack.pop();
    }

    if (debug.enabled) {
        debug('read data: ' + data.toString('hex'));
    }
    return true;
};

module.exports = EbmlDecoder;

}).call(this,require("buffer").Buffer)
},{"./schema.js":21,"./tools.js":22,"buffer":53,"debug":12,"stream":47,"util":52}],19:[function(require,module,exports){
(function (Buffer){
var Transform = require('stream').Transform,
    tools = require('./tools.js'),
    schema = require('./schema.js'),
    debug = require('debug')('ebml:encoder'),
    Buffers = require('buffers');

function EbmlEncoder(options) {
    options = options || {};
    options.writableObjectMode = true;
    Transform.call(this, options);

    this._schema = schema;
    this._buffer = null;
    this._corked = false;

    this._stack = [];
}

require('util').inherits(EbmlEncoder, Transform);

EbmlEncoder.prototype._transform = function(chunk, enc, done) {
    debug('encode ' + chunk[0] + ' ' + chunk[1].name);

    if (chunk[0] === 'start') {
        this.startTag(chunk[1].name, chunk[1]);
    } else if (chunk[0] === 'tag') {
        this.writeTag(chunk[1].name, chunk[1].data);
    } else if (chunk[0] === 'end') {
        this.endTag(chunk[1].name);
    }

    done();
};

EbmlEncoder.prototype._flush = function(done) {
    done = done || function() {};
    if (!this._buffer || this._corked) {
        debug('no buffer/nothing pending');
        done();
        return;
    }

    debug('writing ' + this._buffer.length + ' bytes');

    var chunk = this._buffer.toBuffer();
    this._buffer = null;
    this.push(chunk);
    done();
};

EbmlEncoder.prototype._bufferAndFlush = function(buffer) {
    if (this._buffer) {
        this._buffer.push(buffer);
    } else {
        this._buffer = Buffers([buffer]);
    }
    this._flush();
};

EbmlEncoder.prototype.getSchemaInfo = function(tagName) {
    var tagStrs = Object.keys(this._schema);
    for (var i = 0; i < tagStrs.length; i++) {
        var tagStr = tagStrs[i];
        if (this._schema[tagStr].name === tagName) {
            return new Buffer(tagStr, 'hex');
        }
    }
    return null;
};

EbmlEncoder.prototype.cork = function() {
    this._corked = true;
};

EbmlEncoder.prototype.uncork = function() {
    this._corked = false;
    this._flush();
};

EbmlEncoder.prototype._encodeTag = function(tagId, tagData, end) {
    return Buffers([tagId, end === -1 ? Buffer('01ffffffffffffff', 'hex') : tools.writeVint(tagData.length), tagData]);
};

EbmlEncoder.prototype.writeTag = function(tagName, tagData) {
    var tagId = this.getSchemaInfo(tagName);
    if (!tagId) {
        throw new Error('No schema entry found for ' + tagName);
    }

    var data = this._encodeTag(tagId, tagData);
    if (this._stack.length > 0) {
        this._stack[this._stack.length - 1].children.push({
            data: data
        });
    } else {
        this._bufferAndFlush(data.toBuffer());
    }
};

EbmlEncoder.prototype.startTag = function(tagName, info) {
    var tagId = this.getSchemaInfo(tagName);
    if (!tagId) {
        throw new Error('No schema entry found for ' + tagName);
    }

    var tag = {
        id: tagId,
        name: tagName,
        end: info.end,
        children: []
    };

    if (this._stack.length > 0) {
        this._stack[this._stack.length - 1].children.push(tag);
    }
    this._stack.push(tag);
};

EbmlEncoder.prototype.endTag = function() {
    var tag = this._stack.pop();

    var childTagDataBuffers = tag.children.map(function(child) {
        return child.data;
    });
    tag.data = this._encodeTag(tag.id, Buffers(childTagDataBuffers), tag.end);

    if (this._stack.length < 1) {
        this._bufferAndFlush(tag.data.toBuffer());
    }
};

module.exports = EbmlEncoder;

}).call(this,require("buffer").Buffer)
},{"./schema.js":21,"./tools.js":22,"buffer":53,"buffers":10,"debug":12,"stream":47,"util":52}],20:[function(require,module,exports){
module.exports = {
    tools: require('./tools.js'),
    schema: require('./schema.js'),
    Decoder: require('./decoder.js'),
    Encoder: require('./encoder.js')
};

},{"./decoder.js":18,"./encoder.js":19,"./schema.js":21,"./tools.js":22}],21:[function(require,module,exports){
var schema = {
    "80": {
        "name": "ChapterDisplay",
        "level": "4",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "webm": "1",
        "description": "Contains all possible strings to use for the chapter display."
    },
    "83": {
        "name": "TrackType",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "range": "1-254",
        "description": "A set of track types coded on 8 bits (1: video, 2: audio, 3: complex, 0x10: logo, 0x11: subtitle, 0x12: buttons, 0x20: control)."
    },
    "85": {
        "name": "ChapString",
        "cppname": "ChapterString",
        "level": "5",
        "type": "8",
        "mandatory": "1",
        "minver": "1",
        "webm": "1",
        "description": "Contains the string to use as the chapter atom."
    },
    "86": {
        "name": "CodecID",
        "level": "3",
        "type": "s",
        "mandatory": "1",
        "minver": "1",
        "description": "An ID corresponding to the codec, see the codec page for more info."
    },
    "88": {
        "name": "FlagDefault",
        "cppname": "TrackFlagDefault",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "default": "1",
        "range": "0-1",
        "description": "Set if that track (audio, video or subs) SHOULD be active if no language found matches the user preference. (1 bit)"
    },
    "89": {
        "name": "ChapterTrackNumber",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "range": "not 0",
        "description": "UID of the Track to apply this chapter too. In the absense of a control track, choosing this chapter will select the listed Tracks and deselect unlisted tracks. Absense of this element indicates that the Chapter should be applied to any currently used Tracks."
    },
    "91": {
        "name": "ChapterTimeStart",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "1",
        "description": "Timestamp of the start of Chapter (not scaled)."
    },
    "92": {
        "name": "ChapterTimeEnd",
        "level": "4",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "description": "Timestamp of the end of Chapter (timestamp excluded, not scaled)."
    },
    "96": {
        "name": "CueRefTime",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "minver": "2",
        "webm": "0",
        "description": "Timestamp of the referenced Block."
    },
    "97": {
        "name": "CueRefCluster",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "webm": "0",
        "description": "The Position of the Cluster containing the referenced Block."
    },
    "98": {
        "name": "ChapterFlagHidden",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "range": "0-1",
        "description": "If a chapter is hidden (1), it should not be available to the user interface (but still to Control Tracks; see flag notes). (1 bit)"
    },
    "4254": {
        "name": "ContentCompAlgo",
        "level": "6",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "br": [
            "",
            "",
            "",
            ""
        ],
        "del": [
            "1 - bzlib,",
            "2 - lzo1x"
        ],
        "description": "The compression algorithm used. Algorithms that have been specified so far are: 0 - zlib,   3 - Header Stripping"
    },
    "4255": {
        "name": "ContentCompSettings",
        "level": "6",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "description": "Settings that might be needed by the decompressor. For Header Stripping (ContentCompAlgo=3), the bytes that were removed from the beggining of each frames of the track."
    },
    "4282": {
        "name": "DocType",
        "level": "1",
        "type": "s",
        "mandatory": "1",
        "default": "matroska",
        "minver": "1",
        "description": "A string that describes the type of document that follows this EBML header. 'matroska' in our case or 'webm' for webm files."
    },
    "4285": {
        "name": "DocTypeReadVersion",
        "level": "1",
        "type": "u",
        "mandatory": "1",
        "default": "1",
        "minver": "1",
        "description": "The minimum DocType version an interpreter has to support to read this file."
    },
    "4286": {
        "name": "EBMLVersion",
        "level": "1",
        "type": "u",
        "mandatory": "1",
        "default": "1",
        "minver": "1",
        "description": "The version of EBML parser used to create the file."
    },
    "4287": {
        "name": "DocTypeVersion",
        "level": "1",
        "type": "u",
        "mandatory": "1",
        "default": "1",
        "minver": "1",
        "description": "The version of DocType interpreter used to create the file."
    },
    "4444": {
        "name": "SegmentFamily",
        "level": "2",
        "type": "b",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "bytesize": "16",
        "description": "A randomly generated unique ID that all segments related to each other must use (128 bits)."
    },
    "4461": {
        "name": "DateUTC",
        "level": "2",
        "type": "d",
        "minver": "1",
        "description": "Date of the origin of timestamp (value 0), i.e. production date."
    },
    "4484": {
        "name": "TagDefault",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "1",
        "range": "0-1",
        "description": "Indication to know if this is the default/original language to use for the given tag. (1 bit)"
    },
    "4485": {
        "name": "TagBinary",
        "level": "4",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "description": "The values of the Tag if it is binary. Note that this cannot be used in the same SimpleTag as TagString."
    },
    "4487": {
        "name": "TagString",
        "level": "4",
        "type": "8",
        "minver": "1",
        "webm": "0",
        "description": "The value of the Tag."
    },
    "4489": {
        "name": "Duration",
        "level": "2",
        "type": "f",
        "minver": "1",
        "range": "> 0",
        "description": "Duration of the segment (based on TimecodeScale)."
    },
    "4598": {
        "name": "ChapterFlagEnabled",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "1",
        "range": "0-1",
        "description": "Specify wether the chapter is enabled. It can be enabled/disabled by a Control Track. When disabled, the movie should skip all the content between the TimeStart and TimeEnd of this chapter (see flag notes). (1 bit)"
    },
    "4660": {
        "name": "FileMimeType",
        "level": "3",
        "type": "s",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "MIME type of the file."
    },
    "4661": {
        "name": "FileUsedStartTime",
        "level": "3",
        "type": "u",
        "divx": "1",
        "description": "DivX font extension"
    },
    "4662": {
        "name": "FileUsedEndTime",
        "level": "3",
        "type": "u",
        "divx": "1",
        "description": "DivX font extension"
    },
    "4675": {
        "name": "FileReferral",
        "level": "3",
        "type": "b",
        "webm": "0",
        "description": "A binary value that a track/codec can refer to when the attachment is needed."
    },
    "5031": {
        "name": "ContentEncodingOrder",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "Tells when this modification was used during encoding/muxing starting with 0 and counting upwards. The decoder/demuxer has to start with the highest order number it finds and work its way down. This value has to be unique over all ContentEncodingOrder elements in the segment."
    },
    "5032": {
        "name": "ContentEncodingScope",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "1",
        "range": "not 0",
        "br": [
            "",
            "",
            ""
        ],
        "description": "A bit field that describes which elements have been modified in this way. Values (big endian) can be OR'ed. Possible values: 1 - all frame contents, 2 - the track's private data, 4 - the next ContentEncoding (next ContentEncodingOrder. Either the data inside ContentCompression and/or ContentEncryption)"
    },
    "5033": {
        "name": "ContentEncodingType",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "br": [
            "",
            ""
        ],
        "description": "A value describing what kind of transformation has been done. Possible values: 0 - compression, 1 - encryption"
    },
    "5034": {
        "name": "ContentCompression",
        "level": "5",
        "type": "m",
        "minver": "1",
        "webm": "0",
        "description": "Settings describing the compression used. Must be present if the value of ContentEncodingType is 0 and absent otherwise. Each block must be decompressable even if no previous block is available in order not to prevent seeking."
    },
    "5035": {
        "name": "ContentEncryption",
        "level": "5",
        "type": "m",
        "minver": "1",
        "webm": "0",
        "description": "Settings describing the encryption used. Must be present if the value of ContentEncodingType is 1 and absent otherwise."
    },
    "5378": {
        "name": "CueBlockNumber",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "1",
        "range": "not 0",
        "description": "Number of the Block in the specified Cluster."
    },
    "5654": {
        "name": "ChapterStringUID",
        "level": "4",
        "type": "8",
        "mandatory": "0",
        "minver": "3",
        "webm": "1",
        "description": "A unique string ID to identify the Chapter. Use for WebVTT cue identifier storage."
    },
    "5741": {
        "name": "WritingApp",
        "level": "2",
        "type": "8",
        "mandatory": "1",
        "minver": "1",
        "description": "Writing application (\"mkvmerge-0.3.3\")."
    },
    "5854": {
        "name": "SilentTracks",
        "cppname": "ClusterSilentTracks",
        "level": "2",
        "type": "m",
        "minver": "1",
        "webm": "0",
        "description": "The list of tracks that are not used in that part of the stream. It is useful when using overlay tracks on seeking. Then you should decide what track to use."
    },
    "6240": {
        "name": "ContentEncoding",
        "level": "4",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Settings for one content encoding like compression or encryption."
    },
    "6264": {
        "name": "BitDepth",
        "cppname": "AudioBitDepth",
        "level": "4",
        "type": "u",
        "minver": "1",
        "range": "not 0",
        "description": "Bits per sample, mostly used for PCM."
    },
    "6532": {
        "name": "SignedElement",
        "level": "3",
        "type": "b",
        "multiple": "1",
        "webm": "0",
        "description": "An element ID whose data will be used to compute the signature."
    },
    "6624": {
        "name": "TrackTranslate",
        "level": "3",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "The track identification for the given Chapter Codec."
    },
    "6911": {
        "name": "ChapProcessCommand",
        "cppname": "ChapterProcessCommand",
        "level": "5",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Contains all the commands associated to the Atom."
    },
    "6922": {
        "name": "ChapProcessTime",
        "cppname": "ChapterProcessTime",
        "level": "6",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "Defines when the process command should be handled (0: during the whole chapter, 1: before starting playback, 2: after playback of the chapter)."
    },
    "6924": {
        "name": "ChapterTranslate",
        "level": "2",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "A tuple of corresponding ID used by chapter codecs to represent this segment."
    },
    "6933": {
        "name": "ChapProcessData",
        "cppname": "ChapterProcessData",
        "level": "6",
        "type": "b",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "Contains the command information. The data should be interpreted depending on the ChapProcessCodecID value. For ChapProcessCodecID = 1, the data correspond to the binary DVD cell pre/post commands."
    },
    "6944": {
        "name": "ChapProcess",
        "cppname": "ChapterProcess",
        "level": "4",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Contains all the commands associated to the Atom."
    },
    "6955": {
        "name": "ChapProcessCodecID",
        "cppname": "ChapterProcessCodecID",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "Contains the type of the codec used for the processing. A value of 0 means native Matroska processing (to be defined), a value of 1 means the DVD command set is used. More codec IDs can be added later."
    },
    "7373": {
        "name": "Tag",
        "level": "2",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Element containing elements specific to Tracks/Chapters."
    },
    "7384": {
        "name": "SegmentFilename",
        "level": "2",
        "type": "8",
        "minver": "1",
        "webm": "0",
        "description": "A filename corresponding to this segment."
    },
    "7446": {
        "name": "AttachmentLink",
        "cppname": "TrackAttachmentLink",
        "level": "3",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "range": "not 0",
        "description": "The UID of an attachment that is used by this codec."
    },
    "258688": {
        "name": "CodecName",
        "level": "3",
        "type": "8",
        "minver": "1",
        "description": "A human-readable string specifying the codec."
    },
    "18538067": {
        "name": "Segment",
        "level": "0",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "description": "This element contains all other top-level (level 1) elements. Typically a Matroska file is composed of 1 segment."
    },
    "447a": {
        "name": "TagLanguage",
        "level": "4",
        "type": "s",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "und",
        "description": "Specifies the language of the tag specified, in the Matroska languages form."
    },
    "45a3": {
        "name": "TagName",
        "level": "4",
        "type": "8",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "The name of the Tag that is going to be stored."
    },
    "67c8": {
        "name": "SimpleTag",
        "cppname": "TagSimple",
        "level": "3",
        "recursive": "1",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Contains general information about the target."
    },
    "63c6": {
        "name": "TagAttachmentUID",
        "level": "4",
        "type": "u",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "A unique ID to identify the Attachment(s) the tags belong to. If the value is 0 at this level, the tags apply to all the attachments in the Segment."
    },
    "63c4": {
        "name": "TagChapterUID",
        "level": "4",
        "type": "u",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "A unique ID to identify the Chapter(s) the tags belong to. If the value is 0 at this level, the tags apply to all chapters in the Segment."
    },
    "63c9": {
        "name": "TagEditionUID",
        "level": "4",
        "type": "u",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "A unique ID to identify the EditionEntry(s) the tags belong to. If the value is 0 at this level, the tags apply to all editions in the Segment."
    },
    "63c5": {
        "name": "TagTrackUID",
        "level": "4",
        "type": "u",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "A unique ID to identify the Track(s) the tags belong to. If the value is 0 at this level, the tags apply to all tracks in the Segment."
    },
    "63ca": {
        "name": "TargetType",
        "cppname": "TagTargetType",
        "level": "4",
        "type": "s",
        "minver": "1",
        "webm": "0",
        "strong": "informational",
        "description": "An  string that can be used to display the logical level of the target like \"ALBUM\", \"TRACK\", \"MOVIE\", \"CHAPTER\", etc (see TargetType)."
    },
    "68ca": {
        "name": "TargetTypeValue",
        "cppname": "TagTargetTypeValue",
        "level": "4",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "default": "50",
        "description": "A number to indicate the logical level of the target (see TargetType)."
    },
    "63c0": {
        "name": "Targets",
        "cppname": "TagTargets",
        "level": "3",
        "type": "m",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "Contain all UIDs where the specified meta data apply. It is empty to describe everything in the segment."
    },
    "1254c367": {
        "name": "Tags",
        "level": "1",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Element containing elements specific to Tracks/Chapters. A list of valid tags can be found here."
    },
    "450d": {
        "name": "ChapProcessPrivate",
        "cppname": "ChapterProcessPrivate",
        "level": "5",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "description": "Some optional data attached to the ChapProcessCodecID information. For ChapProcessCodecID = 1, it is the \"DVD level\" equivalent."
    },
    "437e": {
        "name": "ChapCountry",
        "cppname": "ChapterCountry",
        "level": "5",
        "type": "s",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "The countries corresponding to the string, same 2 octets as in Internet domains."
    },
    "437c": {
        "name": "ChapLanguage",
        "cppname": "ChapterLanguage",
        "level": "5",
        "type": "s",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "1",
        "default": "eng",
        "description": "The languages corresponding to the string, in the bibliographic ISO-639-2 form."
    },
    "8f": {
        "name": "ChapterTrack",
        "level": "4",
        "type": "m",
        "minver": "1",
        "webm": "0",
        "description": "List of tracks on which the chapter applies. If this element is not present, all tracks apply"
    },
    "63c3": {
        "name": "ChapterPhysicalEquiv",
        "level": "4",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "description": "Specify the physical equivalent of this ChapterAtom like \"DVD\" (60) or \"SIDE\" (50), see complete list of values."
    },
    "6ebc": {
        "name": "ChapterSegmentEditionUID",
        "level": "4",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "range": "not 0",
        "description": "The EditionUID to play from the segment linked in ChapterSegmentUID."
    },
    "6e67": {
        "name": "ChapterSegmentUID",
        "level": "4",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "range": ">0",
        "bytesize": "16",
        "description": "A segment to play in place of this chapter. Edition ChapterSegmentEditionUID should be used for this segment, otherwise no edition is used."
    },
    "73c4": {
        "name": "ChapterUID",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "1",
        "range": "not 0",
        "description": "A unique ID to identify the Chapter."
    },
    "b6": {
        "name": "ChapterAtom",
        "level": "3",
        "recursive": "1",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "1",
        "description": "Contains the atom information to use as the chapter atom (apply to all tracks)."
    },
    "45dd": {
        "name": "EditionFlagOrdered",
        "level": "3",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "range": "0-1",
        "description": "Specify if the chapters can be defined multiple times and the order to play them is enforced. (1 bit)"
    },
    "45db": {
        "name": "EditionFlagDefault",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "range": "0-1",
        "description": "If a flag is set (1) the edition should be used as the default one. (1 bit)"
    },
    "45bd": {
        "name": "EditionFlagHidden",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "range": "0-1",
        "description": "If an edition is hidden (1), it should not be available to the user interface (but still to Control Tracks; see flag notes). (1 bit)"
    },
    "45bc": {
        "name": "EditionUID",
        "level": "3",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "range": "not 0",
        "description": "A unique ID to identify the edition. It's useful for tagging an edition."
    },
    "45b9": {
        "name": "EditionEntry",
        "level": "2",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "1",
        "description": "Contains all information about a segment edition."
    },
    "1043a770": {
        "name": "Chapters",
        "level": "1",
        "type": "m",
        "minver": "1",
        "webm": "1",
        "description": "A system to define basic menus and partition data. For more detailed information, look at the Chapters Explanation."
    },
    "46ae": {
        "name": "FileUID",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "range": "not 0",
        "description": "Unique ID representing the file, as random as possible."
    },
    "465c": {
        "name": "FileData",
        "level": "3",
        "type": "b",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "The data of the file."
    },
    "466e": {
        "name": "FileName",
        "level": "3",
        "type": "8",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "Filename of the attached file."
    },
    "467e": {
        "name": "FileDescription",
        "level": "3",
        "type": "8",
        "minver": "1",
        "webm": "0",
        "description": "A human-friendly name for the attached file."
    },
    "61a7": {
        "name": "AttachedFile",
        "level": "2",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "An attached file."
    },
    "1941a469": {
        "name": "Attachments",
        "level": "1",
        "type": "m",
        "minver": "1",
        "webm": "0",
        "description": "Contain attached files."
    },
    "eb": {
        "name": "CueRefCodecState",
        "level": "5",
        "type": "u",
        "webm": "0",
        "default": "0",
        "description": "The position of the Codec State corresponding to this referenced element. 0 means that the data is taken from the initial Track Entry."
    },
    "535f": {
        "name": "CueRefNumber",
        "level": "5",
        "type": "u",
        "webm": "0",
        "default": "1",
        "range": "not 0",
        "description": "Number of the referenced Block of Track X in the specified Cluster."
    },
    "db": {
        "name": "CueReference",
        "level": "4",
        "type": "m",
        "multiple": "1",
        "minver": "2",
        "webm": "0",
        "description": "The Clusters containing the required referenced Blocks."
    },
    "ea": {
        "name": "CueCodecState",
        "level": "4",
        "type": "u",
        "minver": "2",
        "webm": "0",
        "default": "0",
        "description": "The position of the Codec State corresponding to this Cue element. 0 means that the data is taken from the initial Track Entry."
    },
    "b2": {
        "name": "CueDuration",
        "level": "4",
        "type": "u",
        "mandatory": "0",
        "minver": "4",
        "webm": "0",
        "description": "The duration of the block according to the segment time base. If missing the track's DefaultDuration does not apply and no duration information is available in terms of the cues."
    },
    "f0": {
        "name": "CueRelativePosition",
        "level": "4",
        "type": "u",
        "mandatory": "0",
        "minver": "4",
        "webm": "0",
        "description": "The relative position of the referenced block inside the cluster with 0 being the first possible position for an element inside that cluster."
    },
    "f1": {
        "name": "CueClusterPosition",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "description": "The position of the Cluster containing the required Block."
    },
    "f7": {
        "name": "CueTrack",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "range": "not 0",
        "description": "The track for which a position is given."
    },
    "b7": {
        "name": "CueTrackPositions",
        "level": "3",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "description": "Contain positions for different tracks corresponding to the timestamp."
    },
    "b3": {
        "name": "CueTime",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "description": "Absolute timestamp according to the segment time base."
    },
    "bb": {
        "name": "CuePoint",
        "level": "2",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "description": "Contains all information relative to a seek point in the segment."
    },
    "1c53bb6b": {
        "name": "Cues",
        "level": "1",
        "type": "m",
        "minver": "1",
        "description": "A top-level element to speed seeking access. All entries are local to the segment. Should be mandatory for non \"live\" streams."
    },
    "47e6": {
        "name": "ContentSigHashAlgo",
        "level": "6",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "br": [
            "",
            ""
        ],
        "description": "The hash algorithm used for the signature. A value of '0' means that the contents have not been signed but only encrypted. Predefined values: 1 - SHA1-160 2 - MD5"
    },
    "47e5": {
        "name": "ContentSigAlgo",
        "level": "6",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "br": "",
        "description": "The algorithm used for the signature. A value of '0' means that the contents have not been signed but only encrypted. Predefined values: 1 - RSA"
    },
    "47e4": {
        "name": "ContentSigKeyID",
        "level": "6",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "description": "This is the ID of the private key the data was signed with."
    },
    "47e3": {
        "name": "ContentSignature",
        "level": "6",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "description": "A cryptographic signature of the contents."
    },
    "47e2": {
        "name": "ContentEncKeyID",
        "level": "6",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "description": "For public key algorithms this is the ID of the public key the the data was encrypted with."
    },
    "47e1": {
        "name": "ContentEncAlgo",
        "level": "6",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "br": "",
        "description": "The encryption algorithm used. The value '0' means that the contents have not been encrypted but only signed. Predefined values: 1 - DES, 2 - 3DES, 3 - Twofish, 4 - Blowfish, 5 - AES"
    },
    "6d80": {
        "name": "ContentEncodings",
        "level": "3",
        "type": "m",
        "minver": "1",
        "webm": "0",
        "description": "Settings for several content encoding mechanisms like compression or encryption."
    },
    "c4": {
        "name": "TrickMasterTrackSegmentUID",
        "level": "3",
        "type": "b",
        "divx": "1",
        "bytesize": "16",
        "description": "DivX trick track extenstions"
    },
    "c7": {
        "name": "TrickMasterTrackUID",
        "level": "3",
        "type": "u",
        "divx": "1",
        "description": "DivX trick track extenstions"
    },
    "c6": {
        "name": "TrickTrackFlag",
        "level": "3",
        "type": "u",
        "divx": "1",
        "default": "0",
        "description": "DivX trick track extenstions"
    },
    "c1": {
        "name": "TrickTrackSegmentUID",
        "level": "3",
        "type": "b",
        "divx": "1",
        "bytesize": "16",
        "description": "DivX trick track extenstions"
    },
    "c0": {
        "name": "TrickTrackUID",
        "level": "3",
        "type": "u",
        "divx": "1",
        "description": "DivX trick track extenstions"
    },
    "ed": {
        "name": "TrackJoinUID",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "multiple": "1",
        "minver": "3",
        "webm": "0",
        "range": "not 0",
        "description": "The trackUID number of a track whose blocks are used to create this virtual track."
    },
    "e9": {
        "name": "TrackJoinBlocks",
        "level": "4",
        "type": "m",
        "minver": "3",
        "webm": "0",
        "description": "Contains the list of all tracks whose Blocks need to be combined to create this virtual track"
    },
    "e6": {
        "name": "TrackPlaneType",
        "level": "6",
        "type": "u",
        "mandatory": "1",
        "minver": "3",
        "webm": "0",
        "description": "The kind of plane this track corresponds to (0: left eye, 1: right eye, 2: background)."
    },
    "e5": {
        "name": "TrackPlaneUID",
        "level": "6",
        "type": "u",
        "mandatory": "1",
        "minver": "3",
        "webm": "0",
        "range": "not 0",
        "description": "The trackUID number of the track representing the plane."
    },
    "e4": {
        "name": "TrackPlane",
        "level": "5",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "3",
        "webm": "0",
        "description": "Contains a video plane track that need to be combined to create this 3D track"
    },
    "e3": {
        "name": "TrackCombinePlanes",
        "level": "4",
        "type": "m",
        "minver": "3",
        "webm": "0",
        "description": "Contains the list of all video plane tracks that need to be combined to create this 3D track"
    },
    "e2": {
        "name": "TrackOperation",
        "level": "3",
        "type": "m",
        "minver": "3",
        "webm": "0",
        "description": "Operation that needs to be applied on tracks to create this virtual track. For more details look at the Specification Notes on the subject."
    },
    "7d7b": {
        "name": "ChannelPositions",
        "cppname": "AudioPosition",
        "level": "4",
        "type": "b",
        "webm": "0",
        "description": "Table of horizontal angles for each successive channel, see appendix."
    },
    "9f": {
        "name": "Channels",
        "cppname": "AudioChannels",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "default": "1",
        "range": "not 0",
        "description": "Numbers of channels in the track."
    },
    "78b5": {
        "name": "OutputSamplingFrequency",
        "cppname": "AudioOutputSamplingFreq",
        "level": "4",
        "type": "f",
        "minver": "1",
        "default": "Sampling Frequency",
        "range": "> 0",
        "description": "Real output sampling frequency in Hz (used for SBR techniques)."
    },
    "b5": {
        "name": "SamplingFrequency",
        "cppname": "AudioSamplingFreq",
        "level": "4",
        "type": "f",
        "mandatory": "1",
        "minver": "1",
        "default": "8000.0",
        "range": "> 0",
        "description": "Sampling frequency in Hz."
    },
    "e1": {
        "name": "Audio",
        "cppname": "TrackAudio",
        "level": "3",
        "type": "m",
        "minver": "1",
        "description": "Audio settings."
    },
    "2383e3": {
        "name": "FrameRate",
        "cppname": "VideoFrameRate",
        "level": "4",
        "type": "f",
        "range": "> 0",
        "strong": "Informational",
        "description": "Number of frames per second.  only."
    },
    "2fb523": {
        "name": "GammaValue",
        "cppname": "VideoGamma",
        "level": "4",
        "type": "f",
        "webm": "0",
        "range": "> 0",
        "description": "Gamma Value."
    },
    "2eb524": {
        "name": "ColourSpace",
        "cppname": "VideoColourSpace",
        "level": "4",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "bytesize": "4",
        "description": "Same value as in AVI (32 bits)."
    },
    "54b3": {
        "name": "AspectRatioType",
        "cppname": "VideoAspectRatio",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "0",
        "description": "Specify the possible modifications to the aspect ratio (0: free resizing, 1: keep aspect ratio, 2: fixed)."
    },
    "54b2": {
        "name": "DisplayUnit",
        "cppname": "VideoDisplayUnit",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "0",
        "description": "How DisplayWidth & DisplayHeight should be interpreted (0: pixels, 1: centimeters, 2: inches, 3: Display Aspect Ratio)."
    },
    "54ba": {
        "name": "DisplayHeight",
        "cppname": "VideoDisplayHeight",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "PixelHeight",
        "range": "not 0",
        "description": "Height of the video frames to display. The default value is only valid when DisplayUnit is 0."
    },
    "54b0": {
        "name": "DisplayWidth",
        "cppname": "VideoDisplayWidth",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "PixelWidth",
        "range": "not 0",
        "description": "Width of the video frames to display. The default value is only valid when DisplayUnit is 0."
    },
    "54dd": {
        "name": "PixelCropRight",
        "cppname": "VideoPixelCropRight",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "0",
        "description": "The number of video pixels to remove on the right of the image."
    },
    "54cc": {
        "name": "PixelCropLeft",
        "cppname": "VideoPixelCropLeft",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "0",
        "description": "The number of video pixels to remove on the left of the image."
    },
    "54bb": {
        "name": "PixelCropTop",
        "cppname": "VideoPixelCropTop",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "0",
        "description": "The number of video pixels to remove at the top of the image."
    },
    "54aa": {
        "name": "PixelCropBottom",
        "cppname": "VideoPixelCropBottom",
        "level": "4",
        "type": "u",
        "minver": "1",
        "default": "0",
        "description": "The number of video pixels to remove at the bottom of the image (for HDTV content)."
    },
    "ba": {
        "name": "PixelHeight",
        "cppname": "VideoPixelHeight",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "range": "not 0",
        "description": "Height of the encoded video frames in pixels."
    },
    "b0": {
        "name": "PixelWidth",
        "cppname": "VideoPixelWidth",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "range": "not 0",
        "description": "Width of the encoded video frames in pixels."
    },
    "53b9": {
        "name": "OldStereoMode",
        "level": "4",
        "type": "u",
        "maxver": "0",
        "webm": "0",
        "divx": "0",
        "description": "DEPRECATED, DO NOT USE. Bogus StereoMode value used in old versions of libmatroska. (0: mono, 1: right eye, 2: left eye, 3: both eyes)."
    },
    "53c0": {
        "name": "AlphaMode",
        "cppname": "VideoAlphaMode",
        "level": "4",
        "type": "u",
        "minver": "3",
        "webm": "1",
        "default": "0",
        "description": "Alpha Video Mode. Presence of this element indicates that the BlockAdditional element could contain Alpha data."
    },
    "53b8": {
        "name": "StereoMode",
        "cppname": "VideoStereoMode",
        "level": "4",
        "type": "u",
        "minver": "3",
        "webm": "1",
        "default": "0",
        "description": "Stereo-3D video mode (0: mono, 1: side by side (left eye is first), 2: top-bottom (right eye is first), 3: top-bottom (left eye is first), 4: checkboard (right is first), 5: checkboard (left is first), 6: row interleaved (right is first), 7: row interleaved (left is first), 8: column interleaved (right is first), 9: column interleaved (left is first), 10: anaglyph (cyan/red), 11: side by side (right eye is first), 12: anaglyph (green/magenta), 13 both eyes laced in one Block (left eye is first), 14 both eyes laced in one Block (right eye is first)) . There are some more details on 3D support in the Specification Notes."
    },
    "9a": {
        "name": "FlagInterlaced",
        "cppname": "VideoFlagInterlaced",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "2",
        "webm": "1",
        "default": "0",
        "range": "0-1",
        "description": "Set if the video is interlaced. (1 bit)"
    },
    "e0": {
        "name": "Video",
        "cppname": "TrackVideo",
        "level": "3",
        "type": "m",
        "minver": "1",
        "description": "Video settings."
    },
    "66a5": {
        "name": "TrackTranslateTrackID",
        "level": "4",
        "type": "b",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "The binary value used to represent this track in the chapter codec data. The format depends on the ChapProcessCodecID used."
    },
    "66bf": {
        "name": "TrackTranslateCodec",
        "level": "4",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "The chapter codec using this ID (0: Matroska Script, 1: DVD-menu)."
    },
    "66fc": {
        "name": "TrackTranslateEditionUID",
        "level": "4",
        "type": "u",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Specify an edition UID on which this translation applies. When not specified, it means for all editions found in the segment."
    },
    "56bb": {
        "name": "SeekPreRoll",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "multiple": "0",
        "default": "0",
        "minver": "4",
        "webm": "1",
        "description": "After a discontinuity, SeekPreRoll is the duration in nanoseconds of the data the decoder must decode before the decoded data is valid."
    },
    "56aa": {
        "name": "CodecDelay",
        "level": "3",
        "type": "u",
        "multiple": "0",
        "default": "0",
        "minver": "4",
        "webm": "1",
        "description": "CodecDelay is The codec-built-in delay in nanoseconds. This value must be subtracted from each block timestamp in order to get the actual timestamp. The value should be small so the muxing of tracks with the same actual timestamp are in the same Cluster."
    },
    "6fab": {
        "name": "TrackOverlay",
        "level": "3",
        "type": "u",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Specify that this track is an overlay track for the Track specified (in the u-integer). That means when this track has a gap (see SilentTracks) the overlay track should be used instead. The order of multiple TrackOverlay matters, the first one is the one that should be used. If not found it should be the second, etc."
    },
    "aa": {
        "name": "CodecDecodeAll",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "2",
        "webm": "0",
        "default": "1",
        "range": "0-1",
        "description": "The codec can decode potentially damaged data (1 bit)."
    },
    "26b240": {
        "name": "CodecDownloadURL",
        "level": "3",
        "type": "s",
        "multiple": "1",
        "webm": "0",
        "description": "A URL to download about the codec used."
    },
    "3b4040": {
        "name": "CodecInfoURL",
        "level": "3",
        "type": "s",
        "multiple": "1",
        "webm": "0",
        "description": "A URL to find information about the codec used."
    },
    "3a9697": {
        "name": "CodecSettings",
        "level": "3",
        "type": "8",
        "webm": "0",
        "description": "A string describing the encoding setting used."
    },
    "63a2": {
        "name": "CodecPrivate",
        "level": "3",
        "type": "b",
        "minver": "1",
        "description": "Private data only known to the codec."
    },
    "22b59c": {
        "name": "Language",
        "cppname": "TrackLanguage",
        "level": "3",
        "type": "s",
        "minver": "1",
        "default": "eng",
        "description": "Specifies the language of the track in the Matroska languages form."
    },
    "536e": {
        "name": "Name",
        "cppname": "TrackName",
        "level": "3",
        "type": "8",
        "minver": "1",
        "description": "A human-readable track name."
    },
    "55ee": {
        "name": "MaxBlockAdditionID",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "The maximum value of BlockAdditions for this track."
    },
    "537f": {
        "name": "TrackOffset",
        "level": "3",
        "type": "i",
        "webm": "0",
        "default": "0",
        "description": "A value to add to the Block's Timestamp. This can be used to adjust the playback offset of a track."
    },
    "23314f": {
        "name": "TrackTimecodeScale",
        "level": "3",
        "type": "f",
        "mandatory": "1",
        "minver": "1",
        "maxver": "3",
        "webm": "0",
        "default": "1.0",
        "range": "> 0",
        "description": "DEPRECATED, DO NOT USE. The scale to apply on this track to work at normal speed in relation with other tracks (mostly used to adjust video speed when the audio length differs)."
    },
    "234e7a": {
        "name": "DefaultDecodedFieldDuration",
        "cppname": "TrackDefaultDecodedFieldDuration",
        "level": "3",
        "type": "u",
        "minver": "4",
        "range": "not 0",
        "description": "The period in nanoseconds (not scaled by TimcodeScale)\nbetween two successive fields at the output of the decoding process (see the notes)"
    },
    "23e383": {
        "name": "DefaultDuration",
        "cppname": "TrackDefaultDuration",
        "level": "3",
        "type": "u",
        "minver": "1",
        "range": "not 0",
        "description": "Number of nanoseconds (not scaled via TimecodeScale) per frame ('frame' in the Matroska sense -- one element put into a (Simple)Block)."
    },
    "6df8": {
        "name": "MaxCache",
        "cppname": "TrackMaxCache",
        "level": "3",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "description": "The maximum cache size required to store referenced frames in and the current frame. 0 means no cache is needed."
    },
    "6de7": {
        "name": "MinCache",
        "cppname": "TrackMinCache",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "The minimum number of frames a player should be able to cache during playback. If set to 0, the reference pseudo-cache system is not used."
    },
    "9c": {
        "name": "FlagLacing",
        "cppname": "TrackFlagLacing",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "default": "1",
        "range": "0-1",
        "description": "Set if the track may contain blocks using lacing. (1 bit)"
    },
    "55aa": {
        "name": "FlagForced",
        "cppname": "TrackFlagForced",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "default": "0",
        "range": "0-1",
        "description": "Set if that track MUST be active during playback. There can be many forced track for a kind (audio, video or subs), the player should select the one which language matches the user preference or the default + forced track. Overlay MAY happen between a forced and non-forced track of the same kind. (1 bit)"
    },
    "b9": {
        "name": "FlagEnabled",
        "cppname": "TrackFlagEnabled",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "2",
        "webm": "1",
        "default": "1",
        "range": "0-1",
        "description": "Set if the track is usable. (1 bit)"
    },
    "73c5": {
        "name": "TrackUID",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "range": "not 0",
        "description": "A unique ID to identify the Track. This should be kept the same when making a direct stream copy of the Track to another file."
    },
    "d7": {
        "name": "TrackNumber",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "range": "not 0",
        "description": "The track number as used in the Block Header (using more than 127 tracks is not encouraged, though the design allows an unlimited number)."
    },
    "ae": {
        "name": "TrackEntry",
        "level": "2",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "description": "Describes a track with all elements."
    },
    "1654ae6b": {
        "name": "Tracks",
        "level": "1",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "description": "A top-level block of information with many tracks described."
    },
    "af": {
        "name": "EncryptedBlock",
        "level": "2",
        "type": "b",
        "multiple": "1",
        "webm": "0",
        "description": "Similar to EncryptedBlock Structure)"
    },
    "ca": {
        "name": "ReferenceTimeCode",
        "level": "4",
        "type": "u",
        "multiple": "0",
        "mandatory": "1",
        "minver": "0",
        "webm": "0",
        "divx": "1",
        "description": "DivX trick track extenstions"
    },
    "c9": {
        "name": "ReferenceOffset",
        "level": "4",
        "type": "u",
        "multiple": "0",
        "mandatory": "1",
        "minver": "0",
        "webm": "0",
        "divx": "1",
        "description": "DivX trick track extenstions"
    },
    "c8": {
        "name": "ReferenceFrame",
        "level": "3",
        "type": "m",
        "multiple": "0",
        "minver": "0",
        "webm": "0",
        "divx": "1",
        "description": "DivX trick track extenstions"
    },
    "cf": {
        "name": "SliceDuration",
        "level": "5",
        "type": "u",
        "default": "0",
        "description": "The (scaled) duration to apply to the element."
    },
    "ce": {
        "name": "Delay",
        "cppname": "SliceDelay",
        "level": "5",
        "type": "u",
        "default": "0",
        "description": "The (scaled) delay to apply to the element."
    },
    "cb": {
        "name": "BlockAdditionID",
        "cppname": "SliceBlockAddID",
        "level": "5",
        "type": "u",
        "default": "0",
        "description": "The ID of the BlockAdditional element (0 is the main Block)."
    },
    "cd": {
        "name": "FrameNumber",
        "cppname": "SliceFrameNumber",
        "level": "5",
        "type": "u",
        "default": "0",
        "description": "The number of the frame to generate from this lace with this delay (allow you to generate many frames from the same Block/Frame)."
    },
    "cc": {
        "name": "LaceNumber",
        "cppname": "SliceLaceNumber",
        "level": "5",
        "type": "u",
        "minver": "1",
        "default": "0",
        "divx": "0",
        "description": "The reverse number of the frame in the lace (0 is the last frame, 1 is the next to last, etc). While there are a few files in the wild with this element, it is no longer in use and has been deprecated. Being able to interpret this element is not required for playback."
    },
    "e8": {
        "name": "TimeSlice",
        "level": "4",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "divx": "0",
        "description": "Contains extra time information about the data contained in the Block. While there are a few files in the wild with this element, it is no longer in use and has been deprecated. Being able to interpret this element is not required for playback."
    },
    "8e": {
        "name": "Slices",
        "level": "3",
        "type": "m",
        "minver": "1",
        "divx": "0",
        "description": "Contains slices description."
    },
    "75a2": {
        "name": "DiscardPadding",
        "level": "3",
        "type": "i",
        "minver": "4",
        "webm": "1",
        "description": "Duration in nanoseconds of the silent data added to the Block (padding at the end of the Block for positive value, at the beginning of the Block for negative value). The duration of DiscardPadding is not calculated in the duration of the TrackEntry and should be discarded during playback."
    },
    "a4": {
        "name": "CodecState",
        "level": "3",
        "type": "b",
        "minver": "2",
        "webm": "0",
        "description": "The new codec state to use. Data interpretation is private to the codec. This information should always be referenced by a seek entry."
    },
    "fd": {
        "name": "ReferenceVirtual",
        "level": "3",
        "type": "i",
        "webm": "0",
        "description": "Relative position of the data that should be in position of the virtual block."
    },
    "fb": {
        "name": "ReferenceBlock",
        "level": "3",
        "type": "i",
        "multiple": "1",
        "minver": "1",
        "description": "Timestamp of another frame used as a reference (ie: B or P frame). The timestamp is relative to the block it's attached to."
    },
    "fa": {
        "name": "ReferencePriority",
        "cppname": "FlagReferenced",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "0",
        "description": "This frame is referenced and has the specified cache priority. In cache only a frame of the same or higher priority can replace this frame. A value of 0 means the frame is not referenced."
    },
    "9b": {
        "name": "BlockDuration",
        "level": "3",
        "type": "u",
        "minver": "1",
        "default": "TrackDuration",
        "description": "The duration of the Block (based on TimecodeScale). This element is mandatory when DefaultDuration is set for the track (but can be omitted as other default values). When not written and with no DefaultDuration, the value is assumed to be the difference between the timestamp of this Block and the timestamp of the next Block in \"display\" order (not coding order). This element can be useful at the end of a Track (as there is not other Block available), or when there is a break in a track like for subtitle tracks. When set to 0 that means the frame is not a keyframe."
    },
    "a5": {
        "name": "BlockAdditional",
        "level": "5",
        "type": "b",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "Interpreted by the codec as it wishes (using the BlockAddID)."
    },
    "ee": {
        "name": "BlockAddID",
        "level": "5",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "default": "1",
        "range": "not 0",
        "description": "An ID to identify the BlockAdditional level."
    },
    "a6": {
        "name": "BlockMore",
        "level": "4",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Contain the BlockAdditional and some parameters."
    },
    "75a1": {
        "name": "BlockAdditions",
        "level": "3",
        "type": "m",
        "minver": "1",
        "webm": "0",
        "description": "Contain additional blocks to complete the main one. An EBML parser that has no knowledge of the Block structure could still see and use/skip these data."
    },
    "a2": {
        "name": "BlockVirtual",
        "level": "3",
        "type": "b",
        "webm": "0",
        "description": "A Block with no data. It must be stored in the stream at the place the real Block should be in display order. (see Block Virtual)"
    },
    "a1": {
        "name": "Block",
        "level": "3",
        "type": "b",
        "mandatory": "1",
        "minver": "1",
        "description": "Block containing the actual data to be rendered and a timestamp relative to the Cluster Timecode. (see Block Structure)"
    },
    "a0": {
        "name": "BlockGroup",
        "level": "2",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "description": "Basic container of information containing a single Block or BlockVirtual, and information specific to that Block/VirtualBlock."
    },
    "a3": {
        "name": "SimpleBlock",
        "level": "2",
        "type": "b",
        "multiple": "1",
        "minver": "2",
        "webm": "1",
        "divx": "1",
        "description": "Similar to SimpleBlock Structure)"
    },
    "ab": {
        "name": "PrevSize",
        "cppname": "ClusterPrevSize",
        "level": "2",
        "type": "u",
        "minver": "1",
        "description": "Size of the previous Cluster, in octets. Can be useful for backward playing."
    },
    "a7": {
        "name": "Position",
        "cppname": "ClusterPosition",
        "level": "2",
        "type": "u",
        "minver": "1",
        "webm": "0",
        "description": "The Position of the Cluster in the segment (0 in live broadcast streams). It might help to resynchronise offset on damaged streams."
    },
    "58d7": {
        "name": "SilentTrackNumber",
        "cppname": "ClusterSilentTrackNumber",
        "level": "3",
        "type": "u",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "One of the track number that are not used from now on in the stream. It could change later if not specified as silent in a further Cluster."
    },
    "e7": {
        "name": "Timecode",
        "cppname": "ClusterTimecode",
        "level": "2",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "description": "Absolute timestamp of the cluster (based on TimecodeScale)."
    },
    "1f43b675": {
        "name": "Cluster",
        "level": "1",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "description": "The lower level element containing the (monolithic) Block structure."
    },
    "4d80": {
        "name": "MuxingApp",
        "level": "2",
        "type": "8",
        "mandatory": "1",
        "minver": "1",
        "description": "Muxing application or library (\"libmatroska-0.4.3\")."
    },
    "7ba9": {
        "name": "Title",
        "level": "2",
        "type": "8",
        "minver": "1",
        "webm": "0",
        "description": "General name of the segment."
    },
    "2ad7b2": {
        "name": "TimecodeScaleDenominator",
        "level": "2",
        "type": "u",
        "mandatory": "1",
        "minver": "4",
        "default": "1000000000",
        "description": "Timestamp scale numerator, see TimecodeScale."
    },
    "2ad7b1": {
        "name": "TimecodeScale",
        "level": "2",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "default": "1000000",
        "description": "Timestamp scale in nanoseconds (1.000.000 means all timestamps in the segment are expressed in milliseconds)."
    },
    "69a5": {
        "name": "ChapterTranslateID",
        "level": "3",
        "type": "b",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "The binary value used to represent this segment in the chapter codec data. The format depends on the ChapProcessCodecID used."
    },
    "69bf": {
        "name": "ChapterTranslateCodec",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "webm": "0",
        "description": "The chapter codec using this ID (0: Matroska Script, 1: DVD-menu)."
    },
    "69fc": {
        "name": "ChapterTranslateEditionUID",
        "level": "3",
        "type": "u",
        "multiple": "1",
        "minver": "1",
        "webm": "0",
        "description": "Specify an edition UID on which this correspondance applies. When not specified, it means for all editions found in the segment."
    },
    "3e83bb": {
        "name": "NextFilename",
        "level": "2",
        "type": "8",
        "minver": "1",
        "webm": "0",
        "description": "An escaped filename corresponding to the next segment."
    },
    "3eb923": {
        "name": "NextUID",
        "level": "2",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "bytesize": "16",
        "description": "A unique ID to identify the next chained segment (128 bits)."
    },
    "3c83ab": {
        "name": "PrevFilename",
        "level": "2",
        "type": "8",
        "minver": "1",
        "webm": "0",
        "description": "An escaped filename corresponding to the previous segment."
    },
    "3cb923": {
        "name": "PrevUID",
        "level": "2",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "bytesize": "16",
        "description": "A unique ID to identify the previous chained segment (128 bits)."
    },
    "73a4": {
        "name": "SegmentUID",
        "level": "2",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "range": "not 0",
        "bytesize": "16",
        "description": "A randomly generated unique ID to identify the current segment between many others (128 bits)."
    },
    "1549a966": {
        "name": "Info",
        "level": "1",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "description": "Contains miscellaneous general information and statistics on the file."
    },
    "53ac": {
        "name": "SeekPosition",
        "level": "3",
        "type": "u",
        "mandatory": "1",
        "minver": "1",
        "description": "The position of the element in the segment in octets (0 = first level 1 element)."
    },
    "53ab": {
        "name": "SeekID",
        "level": "3",
        "type": "b",
        "mandatory": "1",
        "minver": "1",
        "description": "The binary ID corresponding to the element name."
    },
    "4dbb": {
        "name": "Seek",
        "cppname": "SeekPoint",
        "level": "2",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "description": "Contains a single seek entry to an EBML element."
    },
    "114d9b74": {
        "name": "SeekHead",
        "cppname": "SeekHeader",
        "level": "1",
        "type": "m",
        "multiple": "1",
        "minver": "1",
        "description": "Contains the position of other level 1 elements."
    },
    "7e7b": {
        "name": "SignatureElementList",
        "level": "2",
        "type": "m",
        "multiple": "1",
        "webm": "0",
        "i": "Cluster|Block|BlockAdditional",
        "description": "A list consists of a number of consecutive elements that represent one case where data is used in signature. Ex:  means that the BlockAdditional of all Blocks in all Clusters is used for encryption."
    },
    "7e5b": {
        "name": "SignatureElements",
        "level": "1",
        "type": "m",
        "webm": "0",
        "description": "Contains elements that will be used to compute the signature."
    },
    "7eb5": {
        "name": "Signature",
        "level": "1",
        "type": "b",
        "webm": "0",
        "description": "The signature of the data (until a new."
    },
    "7ea5": {
        "name": "SignaturePublicKey",
        "level": "1",
        "type": "b",
        "webm": "0",
        "description": "The public key to use with the algorithm (in the case of a PKI-based signature)."
    },
    "7e9a": {
        "name": "SignatureHash",
        "level": "1",
        "type": "u",
        "webm": "0",
        "description": "Hash algorithm used (1=SHA1-160, 2=MD5)."
    },
    "7e8a": {
        "name": "SignatureAlgo",
        "level": "1",
        "type": "u",
        "webm": "0",
        "description": "Signature algorithm used (1=RSA, 2=elliptic)."
    },
    "1b538667": {
        "name": "SignatureSlot",
        "level": "-1",
        "type": "m",
        "multiple": "1",
        "webm": "0",
        "description": "Contain signature of some (coming) elements in the stream."
    },
    "bf": {
        "name": "CRC-32",
        "level": "-1",
        "type": "b",
        "minver": "1",
        "webm": "0",
        "description": "The CRC is computed on all the data of the Master element it's in. The CRC element should be the first in it's parent master for easier reading. All level 1 elements should include a CRC-32. The CRC in use is the IEEE CRC32 Little Endian"
    },
    "ec": {
        "name": "Void",
        "level": "-1",
        "type": "b",
        "minver": "1",
        "description": "Used to void damaged data, to avoid unexpected behaviors when using damaged data. The content is discarded. Also used to reserve space in a sub-element for later use."
    },
    "42f3": {
        "name": "EBMLMaxSizeLength",
        "level": "1",
        "type": "u",
        "mandatory": "1",
        "default": "8",
        "minver": "1",
        "description": "The maximum length of the sizes you'll find in this file (8 or less in Matroska). This does not override the element size indicated at the beginning of an element. Elements that have an indicated size which is larger than what is allowed by EBMLMaxSizeLength shall be considered invalid."
    },
    "42f2": {
        "name": "EBMLMaxIDLength",
        "level": "1",
        "type": "u",
        "mandatory": "1",
        "default": "4",
        "minver": "1",
        "description": "The maximum length of the IDs you'll find in this file (4 or less in Matroska)."
    },
    "42f7": {
        "name": "EBMLReadVersion",
        "level": "1",
        "type": "u",
        "mandatory": "1",
        "default": "1",
        "minver": "1",
        "description": "The minimum EBML version a parser has to support to read this file."
    },
    "1a45dfa3": {
        "name": "EBML",
        "level": "0",
        "type": "m",
        "mandatory": "1",
        "multiple": "1",
        "minver": "1",
        "description": "Set the EBML characteristics of the data to follow. Each EBML document has to start with this."
    }
};

module.exports = schema;

},{}],22:[function(require,module,exports){
(function (Buffer){
var tools = {
    readVint: function(buffer, start) {
        start = start || 0;
        for (var length = 1; length <= 8; length++) {
            if (buffer[start] >= Math.pow(2, 8 - length)) {
                break;
            }
        }
        if (length > 8) {
            throw new Error("Unrepresentable length: " + length + " " +
                buffer.toString('hex', start, start + length));
        }
        if (start + length > buffer.length) {
            return null;
        }
        var value = buffer[start] & (1 << (8 - length)) - 1;
        for (var i = 1; i < length; i++) {
            if (i === 7) {
                if (value >= Math.pow(2, 53 - 8) && buffer[start + 7] > 0) {
                    return {
                        length: length,
                        value: -1
                    };
                }
            }
            value *= Math.pow(2, 8);
            value += buffer[start + i];
        }
        return {
            length: length,
            value: value
        };
    },

    writeVint: function(value) {
        if (value < 0 || value > Math.pow(2, 53)) {
            throw new Error("Unrepresentable value: " + value);
        }
        for (var length = 1; length <= 8; length++) {
            if (value < Math.pow(2, 7 * length) - 1) {
                break;
            }
        }
        var buffer = new Buffer(length);
        for (var i = 1; i <= length; i++) {
            var b = value & 0xFF;
            buffer[length - i] = b;
            value -= b;
            value /= Math.pow(2, 8);
        }
        buffer[0] = buffer[0] | (1 << (8 - length));
        return buffer;
    }
};

module.exports = tools;

}).call(this,require("buffer").Buffer)
},{"buffer":53}],23:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],24:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor
      ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      })
    }
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor
      var TempCtor = function () {}
      TempCtor.prototype = superCtor.prototype
      ctor.prototype = new TempCtor()
      ctor.prototype.constructor = ctor
    }
  }
}

},{}],25:[function(require,module,exports){
(function (Buffer){
// int64-buffer.js

/*jshint -W018 */ // Confusing use of '!'.
/*jshint -W030 */ // Expected an assignment or function call and instead saw an expression.
/*jshint -W093 */ // Did you mean to return a conditional instead of an assignment?

var Uint64BE, Int64BE, Uint64LE, Int64LE;

!function(exports) {
  // constants

  var UNDEFINED = "undefined";
  var BUFFER = (UNDEFINED !== typeof Buffer) && Buffer;
  var UINT8ARRAY = (UNDEFINED !== typeof Uint8Array) && Uint8Array;
  var ARRAYBUFFER = (UNDEFINED !== typeof ArrayBuffer) && ArrayBuffer;
  var ZERO = [0, 0, 0, 0, 0, 0, 0, 0];
  var isArray = Array.isArray || _isArray;
  var BIT32 = 4294967296;
  var BIT24 = 16777216;

  // storage class

  var storage; // Array;

  // generate classes

  Uint64BE = factory("Uint64BE", true, true);
  Int64BE = factory("Int64BE", true, false);
  Uint64LE = factory("Uint64LE", false, true);
  Int64LE = factory("Int64LE", false, false);

  // class factory

  function factory(name, bigendian, unsigned) {
    var posH = bigendian ? 0 : 4;
    var posL = bigendian ? 4 : 0;
    var pos0 = bigendian ? 0 : 3;
    var pos1 = bigendian ? 1 : 2;
    var pos2 = bigendian ? 2 : 1;
    var pos3 = bigendian ? 3 : 0;
    var fromPositive = bigendian ? fromPositiveBE : fromPositiveLE;
    var fromNegative = bigendian ? fromNegativeBE : fromNegativeLE;
    var proto = Int64.prototype;
    var isName = "is" + name;
    var _isInt64 = "_" + isName;

    // properties
    proto.buffer = void 0;
    proto.offset = 0;
    proto[_isInt64] = true;

    // methods
    proto.toNumber = toNumber;
    proto.toString = toString;
    proto.toJSON = toNumber;
    proto.toArray = toArray;

    // add .toBuffer() method only when Buffer available
    if (BUFFER) proto.toBuffer = toBuffer;

    // add .toArrayBuffer() method only when Uint8Array available
    if (UINT8ARRAY) proto.toArrayBuffer = toArrayBuffer;

    // isUint64BE, isInt64BE
    Int64[isName] = isInt64;

    // CommonJS
    exports[name] = Int64;

    return Int64;

    // constructor
    function Int64(buffer, offset, value, raddix) {
      if (!(this instanceof Int64)) return new Int64(buffer, offset, value, raddix);
      return init(this, buffer, offset, value, raddix);
    }

    // isUint64BE, isInt64BE
    function isInt64(b) {
      return !!(b && b[_isInt64]);
    }

    // initializer
    function init(that, buffer, offset, value, raddix) {
      if (UINT8ARRAY && ARRAYBUFFER) {
        if (buffer instanceof ARRAYBUFFER) buffer = new UINT8ARRAY(buffer);
        if (value instanceof ARRAYBUFFER) value = new UINT8ARRAY(value);
      }

      // Int64BE() style
      if (!buffer && !offset && !value && !storage) {
        // shortcut to initialize with zero
        that.buffer = newArray(ZERO, 0);
        return;
      }

      // Int64BE(value, raddix) style
      if (!isValidBuffer(buffer, offset)) {
        var _storage = storage || Array;
        raddix = offset;
        value = buffer;
        offset = 0;
        buffer = new _storage(8);
      }

      that.buffer = buffer;
      that.offset = offset |= 0;

      // Int64BE(buffer, offset) style
      if (UNDEFINED === typeof value) return;

      // Int64BE(buffer, offset, value, raddix) style
      if ("string" === typeof value) {
        fromString(buffer, offset, value, raddix || 10);
      } else if (isValidBuffer(value, raddix)) {
        fromArray(buffer, offset, value, raddix);
      } else if ("number" === typeof raddix) {
        writeInt32(buffer, offset + posH, value); // high
        writeInt32(buffer, offset + posL, raddix); // low
      } else if (value > 0) {
        fromPositive(buffer, offset, value); // positive
      } else if (value < 0) {
        fromNegative(buffer, offset, value); // negative
      } else {
        fromArray(buffer, offset, ZERO, 0); // zero, NaN and others
      }
    }

    function fromString(buffer, offset, str, raddix) {
      var pos = 0;
      var len = str.length;
      var high = 0;
      var low = 0;
      if (str[0] === "-") pos++;
      var sign = pos;
      while (pos < len) {
        var chr = parseInt(str[pos++], raddix);
        if (!(chr >= 0)) break; // NaN
        low = low * raddix + chr;
        high = high * raddix + Math.floor(low / BIT32);
        low %= BIT32;
      }
      if (sign) {
        high = ~high;
        if (low) {
          low = BIT32 - low;
        } else {
          high++;
        }
      }
      writeInt32(buffer, offset + posH, high);
      writeInt32(buffer, offset + posL, low);
    }

    function toNumber() {
      var buffer = this.buffer;
      var offset = this.offset;
      var high = readInt32(buffer, offset + posH);
      var low = readInt32(buffer, offset + posL);
      if (!unsigned) high |= 0; // a trick to get signed
      return high ? (high * BIT32 + low) : low;
    }

    function toString(radix) {
      var buffer = this.buffer;
      var offset = this.offset;
      var high = readInt32(buffer, offset + posH);
      var low = readInt32(buffer, offset + posL);
      var str = "";
      var sign = !unsigned && (high & 0x80000000);
      if (sign) {
        high = ~high;
        low = BIT32 - low;
      }
      radix = radix || 10;
      while (1) {
        var mod = (high % radix) * BIT32 + low;
        high = Math.floor(high / radix);
        low = Math.floor(mod / radix);
        str = (mod % radix).toString(radix) + str;
        if (!high && !low) break;
      }
      if (sign) {
        str = "-" + str;
      }
      return str;
    }

    function writeInt32(buffer, offset, value) {
      buffer[offset + pos3] = value & 255;
      value = value >> 8;
      buffer[offset + pos2] = value & 255;
      value = value >> 8;
      buffer[offset + pos1] = value & 255;
      value = value >> 8;
      buffer[offset + pos0] = value & 255;
    }

    function readInt32(buffer, offset) {
      return (buffer[offset + pos0] * BIT24) +
        (buffer[offset + pos1] << 16) +
        (buffer[offset + pos2] << 8) +
        buffer[offset + pos3];
    }
  }

  function toArray(raw) {
    var buffer = this.buffer;
    var offset = this.offset;
    storage = null; // Array
    if (raw !== false && offset === 0 && buffer.length === 8 && isArray(buffer)) return buffer;
    return newArray(buffer, offset);
  }

  function toBuffer(raw) {
    var buffer = this.buffer;
    var offset = this.offset;
    storage = BUFFER;
    if (raw !== false && offset === 0 && buffer.length === 8 && Buffer.isBuffer(buffer)) return buffer;
    var dest = new BUFFER(8);
    fromArray(dest, 0, buffer, offset);
    return dest;
  }

  function toArrayBuffer(raw) {
    var buffer = this.buffer;
    var offset = this.offset;
    var arrbuf = buffer.buffer;
    storage = UINT8ARRAY;
    if (raw !== false && offset === 0 && (arrbuf instanceof ARRAYBUFFER) && arrbuf.byteLength === 8) return arrbuf;
    var dest = new UINT8ARRAY(8);
    fromArray(dest, 0, buffer, offset);
    return dest.buffer;
  }

  function isValidBuffer(buffer, offset) {
    var len = buffer && buffer.length;
    offset |= 0;
    return len && (offset + 8 <= len) && ("string" !== typeof buffer[offset]);
  }

  function fromArray(destbuf, destoff, srcbuf, srcoff) {
    destoff |= 0;
    srcoff |= 0;
    for (var i = 0; i < 8; i++) {
      destbuf[destoff++] = srcbuf[srcoff++] & 255;
    }
  }

  function newArray(buffer, offset) {
    return Array.prototype.slice.call(buffer, offset, offset + 8);
  }

  function fromPositiveBE(buffer, offset, value) {
    var pos = offset + 8;
    while (pos > offset) {
      buffer[--pos] = value & 255;
      value /= 256;
    }
  }

  function fromNegativeBE(buffer, offset, value) {
    var pos = offset + 8;
    value++;
    while (pos > offset) {
      buffer[--pos] = ((-value) & 255) ^ 255;
      value /= 256;
    }
  }

  function fromPositiveLE(buffer, offset, value) {
    var end = offset + 8;
    while (offset < end) {
      buffer[offset++] = value & 255;
      value /= 256;
    }
  }

  function fromNegativeLE(buffer, offset, value) {
    var end = offset + 8;
    value++;
    while (offset < end) {
      buffer[offset++] = ((-value) & 255) ^ 255;
      value /= 256;
    }
  }

  // https://github.com/retrofox/is-array
  function _isArray(val) {
    return !!val && "[object Array]" == Object.prototype.toString.call(val);
  }

}(typeof exports === 'object' && typeof exports.nodeName !== 'string' ? exports : (this || {}));

}).call(this,require("buffer").Buffer)
},{"buffer":53}],26:[function(require,module,exports){
/*!
 * Determine if an object is a Buffer
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */

// The _isBuffer check is for Safari 5-7 support, because it's missing
// Object.prototype.constructor. Remove this eventually
module.exports = function (obj) {
  return obj != null && (isBuffer(obj) || isSlowBuffer(obj) || !!obj._isBuffer)
}

function isBuffer (obj) {
  return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
}

// For Node v0.10 support. Remove this eventually.
function isSlowBuffer (obj) {
  return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isBuffer(obj.slice(0, 0))
}

},{}],27:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],28:[function(require,module,exports){
/*jslint node: true, vars: true, nomen: true */
'use strict';

var byEbmlID = {
	0x80: {
		name: "ChapterDisplay",
		level: 4,
		type: "m",
		multiple: true,
		minver: 1,
		webm: true,
		description: "Contains all possible strings to use for the chapter display."
	},
	0x83: {
		name: "TrackType",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		range: "1-254",
		description: "A set of track types coded on 8 bits (1: video, 2: audio, 3: complex, 0x10: logo, 0x11: subtitle, 0x12: buttons, 0x20: control)."
	},
	0x85: {
		name: "ChapString",
		cppname: "ChapterString",
		level: 5,
		type: "8",
		mandatory: true,
		minver: 1,
		webm: true,
		description: "Contains the string to use as the chapter atom."
	},
	0x86: {
		name: "CodecID",
		level: 3,
		type: "s",
		mandatory: true,
		minver: 1,
		description: "An ID corresponding to the codec, see the codec page for more info."
	},
	0x88: {
		name: "FlagDefault",
		cppname: "TrackFlagDefault",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		"default": 1,
		range: "0-1",
		description: "Set if that track (audio, video or subs) SHOULD be active if no language found matches the user preference. (1 bit)"
	},
	0x89: {
		name: "ChapterTrackNumber",
		level: 5,
		type: "u",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: false,
		range: "not 0",
		description: "UID of the Track to apply this chapter too. In the absense of a control track, choosing this chapter will select the listed Tracks and deselect unlisted tracks. Absense of this element indicates that the Chapter should be applied to any currently used Tracks."
	},
	0x91: {
		name: "ChapterTimeStart",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: true,
		description: "Timestamp of the start of Chapter (not scaled)."
	},
	0x92: {
		name: "ChapterTimeEnd",
		level: 4,
		type: "u",
		minver: 1,
		webm: false,
		description: "Timestamp of the end of Chapter (timestamp excluded, not scaled)."
	},
	0x96: {
		name: "CueRefTime",
		level: 5,
		type: "u",
		mandatory: true,
		minver: 2,
		webm: false,
		description: "Timestamp of the referenced Block."
	},
	0x97: {
		name: "CueRefCluster",
		level: 5,
		type: "u",
		mandatory: true,
		webm: false,
		description: "The Position of the Cluster containing the referenced Block."
	},
	0x98: {
		name: "ChapterFlagHidden",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		range: "0-1",
		description: "If a chapter is hidden (1), it should not be available to the user interface (but still to Control Tracks; see flag notes). (1 bit)"
	},
	0x4254: {
		name: "ContentCompAlgo",
		level: 6,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		// "br": [ "", "", "", "" ],
		// "del": [ "1 - bzlib,", "2 - lzo1x" ],
		description: "The compression algorithm used. Algorithms that have been specified so far are: 0 - zlib,   3 - Header Stripping"
	},
	0x4255: {
		name: "ContentCompSettings",
		level: 6,
		type: "b",
		minver: 1,
		webm: false,
		description: "Settings that might be needed by the decompressor. For Header Stripping (ContentCompAlgo=3), the bytes that were removed from the beggining of each frames of the track."
	},
	0x4282: {
		name: "DocType",
		level: 1,
		type: "s",
		mandatory: true,
		"default": "matroska",
		minver: 1,
		description: "A string that describes the type of document that follows this EBML header. 'matroska' in our case or 'webm' for webm files."
	},
	0x4285: {
		name: "DocTypeReadVersion",
		level: 1,
		type: "u",
		mandatory: true,
		"default": 1,
		minver: 1,
		description: "The minimum DocType version an interpreter has to support to read this file."
	},
	0x4286: {
		name: "EBMLVersion",
		level: 1,
		type: "u",
		mandatory: true,
		"default": 1,
		minver: 1,
		description: "The version of EBML parser used to create the file."
	},
	0x4287: {
		name: "DocTypeVersion",
		level: 1,
		type: "u",
		mandatory: true,
		"default": 1,
		minver: 1,
		description: "The version of DocType interpreter used to create the file."
	},
	0x4444: {
		name: "SegmentFamily",
		level: 2,
		type: "b",
		multiple: true,
		minver: 1,
		webm: false,
		bytesize: 16,
		description: "A randomly generated unique ID that all segments related to each other must use (128 bits)."
	},
	0x4461: {
		name: "DateUTC",
		level: 2,
		type: "d",
		minver: 1,
		description: "Date of the origin of timestamp (value 0), i.e. production date."
	},
	0x4484: {
		name: "TagDefault",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 1,
		range: "0-1",
		description: "Indication to know if this is the default/original language to use for the given tag. (1 bit)"
	},
	0x4485: {
		name: "TagBinary",
		level: 4,
		type: "b",
		minver: 1,
		webm: false,
		description: "The values of the Tag if it is binary. Note that this cannot be used in the same SimpleTag as TagString."
	},
	0x4487: {
		name: "TagString",
		level: 4,
		type: "8",
		minver: 1,
		webm: false,
		description: "The value of the Element."
	},
	0x4489: {
		name: "Duration",
		level: 2,
		type: "f",
		minver: 1,
		range: "> 0",
		description: "Duration of the segment (based on TimecodeScale)."
	},
	0x4598: {
		name: "ChapterFlagEnabled",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 1,
		range: "0-1",
		description: "Specify wether the chapter is enabled. It can be enabled/disabled by a Control Track. When disabled, the movie should skip all the content between the TimeStart and TimeEnd of this chapter (see flag notes). (1 bit)"
	},
	0x4660: {
		name: "FileMimeType",
		level: 3,
		type: "s",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "MIME type of the file."
	},
	0x4661: {
		name: "FileUsedStartTime",
		level: 3,
		type: "u",
		divx: true,
		description: "DivX font extension"
	},
	0x4662: {
		name: "FileUsedEndTime",
		level: 3,
		type: "u",
		divx: true,
		description: "DivX font extension"
	},
	0x4675: {
		name: "FileReferral",
		level: 3,
		type: "b",
		webm: false,
		description: "A binary value that a track/codec can refer to when the attachment is needed."
	},
	0x5031: {
		name: "ContentEncodingOrder",
		level: 5,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "Tells when this modification was used during encoding/muxing starting with 0 and counting upwards. The decoder/demuxer has to start with the highest order number it finds and work its way down. This value has to be unique over all ContentEncodingOrder elements in the segment."
	},
	0x5032: {
		name: "ContentEncodingScope",
		level: 5,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 1,
		range: "not 0",
		// "br": [ "", "", "" ],
		description: "A bit field that describes which elements have been modified in this way. Values (big endian) can be OR'ed. Possible values: 1 - all frame contents, 2 - the track's private data, 4 - the next ContentEncoding (next ContentEncodingOrder. Either the data inside ContentCompression and/or ContentEncryption)"
	},
	0x5033: {
		name: "ContentEncodingType",
		level: 5,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		// "br": [ "", "" ],
		description: "A value describing what kind of transformation has been done. Possible values: 0 - compression, 1 - encryption"
	},
	0x5034: {
		name: "ContentCompression",
		level: 5,
		type: "m",
		minver: 1,
		webm: false,
		description: "Settings describing the compression used. Must be present if the value of ContentEncodingType is 0 and absent otherwise. Each block must be decompressable even if no previous block is available in order not to prevent seeking."
	},
	0x5035: {
		name: "ContentEncryption",
		level: 5,
		type: "m",
		minver: 1,
		webm: false,
		description: "Settings describing the encryption used. Must be present if the value of ContentEncodingType is 1 and absent otherwise."
	},
	0x5378: {
		name: "CueBlockNumber",
		level: 4,
		type: "u",
		minver: 1,
		"default": 1,
		range: "not 0",
		description: "Number of the Block in the specified Cluster."
	},
	0x5654: {
		name: "ChapterStringUID",
		level: 4,
		type: "8",
		mandatory: false,
		minver: 3,
		webm: true,
		description: "A unique string ID to identify the Chapter. Use for WebVTT cue identifier storage."
	},
	0x5741: {
		name: "WritingApp",
		level: 2,
		type: "8",
		mandatory: true,
		minver: 1,
		description: "Writing application (\"mkvmerge-0.3.3\")."
	},
	0x5854: {
		name: "SilentTracks",
		cppname: "ClusterSilentTracks",
		level: 2,
		type: "m",
		minver: 1,
		webm: false,
		description: "The list of tracks that are not used in that part of the stream. It is useful when using overlay tracks on seeking. Then you should decide what track to use."
	},
	0x6240: {
		name: "ContentEncoding",
		level: 4,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: false,
		description: "Settings for one content encoding like compression or encryption."
	},
	0x6264: {
		name: "BitDepth",
		cppname: "AudioBitDepth",
		level: 4,
		type: "u",
		minver: 1,
		range: "not 0",
		description: "Bits per sample, mostly used for PCM."
	},
	0x6532: {
		name: "SignedElement",
		level: 3,
		type: "b",
		multiple: true,
		webm: false,
		description: "An element ID whose data will be used to compute the signature."
	},
	0x6624: {
		name: "TrackTranslate",
		level: 3,
		type: "m",
		multiple: true,
		minver: 1,
		webm: false,
		description: "The track identification for the given Chapter Codec."
	},
	0x6911: {
		name: "ChapProcessCommand",
		cppname: "ChapterProcessCommand",
		level: 5,
		type: "m",
		multiple: true,
		minver: 1,
		webm: false,
		description: "Contains all the commands associated to the Atom."
	},
	0x6922: {
		name: "ChapProcessTime",
		cppname: "ChapterProcessTime",
		level: 6,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "Defines when the process command should be handled (0: during the whole chapter, 1: before starting playback, 2: after playback of the chapter)."
	},
	0x6924: {
		name: "ChapterTranslate",
		level: 2,
		type: "m",
		multiple: true,
		minver: 1,
		webm: false,
		description: "A tuple of corresponding ID used by chapter codecs to represent this segment."
	},
	0x6933: {
		name: "ChapProcessData",
		cppname: "ChapterProcessData",
		level: 6,
		type: "b",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "Contains the command information. The data should be interpreted depending on the ChapProcessCodecID value. For ChapProcessCodecID = 1, the data correspond to the binary DVD cell pre/post commands."
	},
	0x6944: {
		name: "ChapProcess",
		cppname: "ChapterProcess",
		level: 4,
		type: "m",
		multiple: true,
		minver: 1,
		webm: false,
		description: "Contains all the commands associated to the Atom."
	},
	0x6955: {
		name: "ChapProcessCodecID",
		cppname: "ChapterProcessCodecID",
		level: 5,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "Contains the type of the codec used for the processing. A value of 0 means native Matroska processing (to be defined), a value of 1 means the DVD command set is used. More codec IDs can be added later."
	},
	0x7373: {
		name: "Tag",
		level: 2,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: false,
		description: "Element containing elements specific to Tracks/Chapters."
	},
	0x7384: {
		name: "SegmentFilename",
		level: 2,
		type: "8",
		minver: 1,
		webm: false,
		description: "A filename corresponding to this segment."
	},
	0x7446: {
		name: "AttachmentLink",
		cppname: "TrackAttachmentLink",
		level: 3,
		type: "u",
		minver: 1,
		webm: false,
		range: "not 0",
		description: "The UID of an attachment that is used by this codec."
	},
	0x258688: {
		name: "CodecName",
		level: 3,
		type: "8",
		minver: 1,
		description: "A human-readable string specifying the codec."
	},
	0x18538067: {
		name: "Segment",
		level: "0",
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		description: "This element contains all other top-level (level 1) elements. Typically a Matroska file is composed of 1 segment."
	},
	0x447a: {
		name: "TagLanguage",
		level: 4,
		type: "s",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": "und",
		description: "Specifies the language of the tag specified, in the Matroska languages form."
	},
	0x45a3: {
		name: "TagName",
		level: 4,
		type: "8",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "The name of the Tag that is going to be stored."
	},
	0x67c8: {
		name: "SimpleTag",
		cppname: "TagSimple",
		level: 3,
		"recursive": "1",
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: false,
		description: "Contains general information about the target."
	},
	0x63c6: {
		name: "TagAttachmentUID",
		level: 4,
		type: "u",
		multiple: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "A unique ID to identify the Attachment(s) the tags belong to. If the value is 0 at this level, the tags apply to all the attachments in the Segment."
	},
	0x63c4: {
		name: "TagChapterUID",
		level: 4,
		type: "u",
		multiple: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "A unique ID to identify the Chapter(s) the tags belong to. If the value is 0 at this level, the tags apply to all chapters in the Segment."
	},
	0x63c9: {
		name: "TagEditionUID",
		level: 4,
		type: "u",
		multiple: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "A unique ID to identify the EditionEntry(s) the tags belong to. If the value is 0 at this level, the tags apply to all editions in the Segment."
	},
	0x63c5: {
		name: "TagTrackUID",
		level: 4,
		type: "u",
		multiple: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "A unique ID to identify the Track(s) the tags belong to. If the value is 0 at this level, the tags apply to all tracks in the Segment."
	},
	0x63ca: {
		name: "TargetType",
		cppname: "TagTargetType",
		level: 4,
		type: "s",
		minver: 1,
		webm: false,
		"strong": "informational",
		description: "An  string that can be used to display the logical level of the target like \"ALBUM\", \"TRACK\", \"MOVIE\", \"CHAPTER\", etc (see TargetType)."
	},
	0x68ca: {
		name: "TargetTypeValue",
		cppname: "TagTargetTypeValue",
		level: 4,
		type: "u",
		minver: 1,
		webm: false,
		"default": 50,
		description: "A number to indicate the logical level of the target (see TargetType)."
	},
	0x63c0: {
		name: "Targets",
		cppname: "TagTargets",
		level: 3,
		type: "m",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "Contain all UIDs where the specified meta data apply. It is empty to describe everything in the segment."
	},
	0x1254c367: {
		name: "Tags",
		level: 1,
		type: "m",
		multiple: true,
		minver: 1,
		webm: false,
		description: "Element containing elements specific to Tracks/Chapters. A list of valid tags can be found here."
	},
	0x450d: {
		name: "ChapProcessPrivate",
		cppname: "ChapterProcessPrivate",
		level: 5,
		type: "b",
		minver: 1,
		webm: false,
		description: "Some optional data attached to the ChapProcessCodecID information. For ChapProcessCodecID = 1, it is the \"DVD level\" equivalent."
	},
	0x437e: {
		name: "ChapCountry",
		cppname: "ChapterCountry",
		level: 5,
		type: "s",
		multiple: true,
		minver: 1,
		webm: false,
		description: "The countries corresponding to the string, same 2 octets as in Internet domains."
	},
	0x437c: {
		name: "ChapLanguage",
		cppname: "ChapterLanguage",
		level: 5,
		type: "s",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: true,
		"default": "eng",
		description: "The languages corresponding to the string, in the bibliographic ISO-639-2 form."
	},
	0x8f: {
		name: "ChapterTrack",
		level: 4,
		type: "m",
		minver: 1,
		webm: false,
		description: "List of tracks on which the chapter applies. If this element is not present, all tracks apply"
	},
	0x63c3: {
		name: "ChapterPhysicalEquiv",
		level: 4,
		type: "u",
		minver: 1,
		webm: false,
		description: "Specify the physical equivalent of this ChapterAtom like \"DVD\" (60) or \"SIDE\" (50), see complete list of values."
	},
	0x6ebc: {
		name: "ChapterSegmentEditionUID",
		level: 4,
		type: "u",
		minver: 1,
		webm: false,
		range: "not 0",
		description: "The EditionUID to play from the segment linked in ChapterSegmentUID."
	},
	0x6e67: {
		name: "ChapterSegmentUID",
		level: 4,
		type: "b",
		minver: 1,
		webm: false,
		range: ">0",
		bytesize: 16,
		description: "A segment to play in place of this chapter. Edition ChapterSegmentEditionUID should be used for this segment, otherwise no edition is used."
	},
	0x73c4: {
		name: "ChapterUID",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: true,
		range: "not 0",
		description: "A unique ID to identify the Chapter."
	},
	0xb6: {
		name: "ChapterAtom",
		level: 3,
		"recursive": "1",
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: true,
		description: "Contains the atom information to use as the chapter atom (apply to all tracks)."
	},
	0x45dd: {
		name: "EditionFlagOrdered",
		level: 3,
		type: "u",
		minver: 1,
		webm: false,
		"default": 0,
		range: "0-1",
		description: "Specify if the chapters can be defined multiple times and the order to play them is enforced. (1 bit)"
	},
	0x45db: {
		name: "EditionFlagDefault",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		range: "0-1",
		description: "If a flag is set (1) the edition should be used as the default one. (1 bit)"
	},
	0x45bd: {
		name: "EditionFlagHidden",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		range: "0-1",
		description: "If an edition is hidden (1), it should not be available to the user interface (but still to Control Tracks; see flag notes). (1 bit)"
	},
	0x45bc: {
		name: "EditionUID",
		level: 3,
		type: "u",
		minver: 1,
		webm: false,
		range: "not 0",
		description: "A unique ID to identify the edition. It's useful for tagging an edition."
	},
	0x45b9: {
		name: "EditionEntry",
		level: 2,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: true,
		description: "Contains all information about a segment edition."
	},
	0x1043a770: {
		name: "Chapters",
		level: 1,
		type: "m",
		minver: 1,
		webm: true,
		description: "A system to define basic menus and partition data. For more detailed information, look at the Chapters Explanation."
	},
	0x46ae: {
		name: "FileUID",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		range: "not 0",
		description: "Unique ID representing the file, as random as possible."
	},
	0x465c: {
		name: "FileData",
		level: 3,
		type: "b",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "The data of the file."
	},
	0x466e: {
		name: "FileName",
		level: 3,
		type: "8",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "Filename of the attached file."
	},
	0x467e: {
		name: "FileDescription",
		level: 3,
		type: "8",
		minver: 1,
		webm: false,
		description: "A human-friendly name for the attached file."
	},
	0x61a7: {
		name: "AttachedFile",
		level: 2,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: false,
		description: "An attached file."
	},
	0x1941a469: {
		name: "Attachments",
		level: 1,
		type: "m",
		minver: 1,
		webm: false,
		description: "Contain attached files."
	},
	0xeb: {
		name: "CueRefCodecState",
		level: 5,
		type: "u",
		webm: false,
		"default": 0,
		description: "The position of the Codec State corresponding to this referenced element. 0 means that the data is taken from the initial Track Entry."
	},
	0x535f: {
		name: "CueRefNumber",
		level: 5,
		type: "u",
		webm: false,
		"default": 1,
		range: "not 0",
		description: "Number of the referenced Block of Track X in the specified Cluster."
	},
	0xdb: {
		name: "CueReference",
		level: 4,
		type: "m",
		multiple: true,
		minver: 2,
		webm: false,
		description: "The Clusters containing the required referenced Blocks."
	},
	0xea: {
		name: "CueCodecState",
		level: 4,
		type: "u",
		minver: 2,
		webm: false,
		"default": 0,
		description: "The position of the Codec State corresponding to this Cue element. 0 means that the data is taken from the initial Track Entry."
	},
	0xb2: {
		name: "CueDuration",
		level: 4,
		type: "u",
		mandatory: false,
		minver: 4,
		webm: false,
		description: "The duration of the block according to the segment time base. If missing the track's DefaultDuration does not apply and no duration information is available in terms of the cues."
	},
	0xf0: {
		name: "CueRelativePosition",
		level: 4,
		type: "u",
		mandatory: false,
		minver: 4,
		webm: false,
		description: "The relative position of the referenced block inside the cluster with 0 being the first possible position for an element inside that cluster.",
		position: "clusterRelative"
	},
	0xf1: {
		name: "CueClusterPosition",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		description: "The position of the Cluster containing the required Block.",
		position: "segment",
	},
	0xf7: {
		name: "CueTrack",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		range: "not 0",
		description: "The track for which a position is given."
	},
	0xb7: {
		name: "CueTrackPositions",
		level: 3,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		description: "Contain positions for different tracks corresponding to the timestamp."
	},
	0xb3: {
		name: "CueTime",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		description: "Absolute timestamp according to the segment time base."
	},
	0xbb: {
		name: "CuePoint",
		level: 2,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		description: "Contains all information relative to a seek point in the segment."
	},
	0x1c53bb6b: {
		name: "Cues",
		level: 1,
		type: "m",
		minver: 1,
		description: "A top-level element to speed seeking access. All entries are local to the segment. Should be mandatory for non \"live\" streams."
	},
	0x47e6: {
		name: "ContentSigHashAlgo",
		level: 6,
		type: "u",
		minver: 1,
		webm: false,
		"default": 0,
		// "br": [ "", "" ],
		description: "The hash algorithm used for the signature. A value of '0' means that the contents have not been signed but only encrypted. Predefined values: 1 - SHA1-160 2 - MD5"
	},
	0x47e5: {
		name: "ContentSigAlgo",
		level: 6,
		type: "u",
		minver: 1,
		webm: false,
		"default": 0,
		// "br": "",
		description: "The algorithm used for the signature. A value of '0' means that the contents have not been signed but only encrypted. Predefined values: 1 - RSA"
	},
	0x47e4: {
		name: "ContentSigKeyID",
		level: 6,
		type: "b",
		minver: 1,
		webm: false,
		description: "This is the ID of the private key the data was signed with."
	},
	0x47e3: {
		name: "ContentSignature",
		level: 6,
		type: "b",
		minver: 1,
		webm: false,
		description: "A cryptographic signature of the contents."
	},
	0x47e2: {
		name: "ContentEncKeyID",
		level: 6,
		type: "b",
		minver: 1,
		webm: false,
		description: "For public key algorithms this is the ID of the public key the the data was encrypted with."
	},
	0x47e1: {
		name: "ContentEncAlgo",
		level: 6,
		type: "u",
		minver: 1,
		webm: false,
		"default": 0,
		// "br": "",
		description: "The encryption algorithm used. The value '0' means that the contents have not been encrypted but only signed. Predefined values: 1 - DES, 2 - 3DES, 3 - Twofish, 4 - Blowfish, 5 - AES"
	},
	0x6d80: {
		name: "ContentEncodings",
		level: 3,
		type: "m",
		minver: 1,
		webm: false,
		description: "Settings for several content encoding mechanisms like compression or encryption."
	},
	0xc4: {
		name: "TrickMasterTrackSegmentUID",
		level: 3,
		type: "b",
		divx: true,
		bytesize: 16,
		description: "DivX trick track extenstions"
	},
	0xc7: {
		name: "TrickMasterTrackUID",
		level: 3,
		type: "u",
		divx: true,
		description: "DivX trick track extenstions"
	},
	0xc6: {
		name: "TrickTrackFlag",
		level: 3,
		type: "u",
		divx: true,
		"default": 0,
		description: "DivX trick track extenstions"
	},
	0xc1: {
		name: "TrickTrackSegmentUID",
		level: 3,
		type: "b",
		divx: true,
		bytesize: 16,
		description: "DivX trick track extenstions"
	},
	0xc0: {
		name: "TrickTrackUID",
		level: 3,
		type: "u",
		divx: true,
		description: "DivX trick track extenstions"
	},
	0xed: {
		name: "TrackJoinUID",
		level: 5,
		type: "u",
		mandatory: true,
		multiple: true,
		minver: 3,
		webm: false,
		range: "not 0",
		description: "The trackUID number of a track whose blocks are used to create this virtual track."
	},
	0xe9: {
		name: "TrackJoinBlocks",
		level: 4,
		type: "m",
		minver: 3,
		webm: false,
		description: "Contains the list of all tracks whose Blocks need to be combined to create this virtual track"
	},
	0xe6: {
		name: "TrackPlaneType",
		level: 6,
		type: "u",
		mandatory: true,
		minver: 3,
		webm: false,
		description: "The kind of plane this track corresponds to (0: left eye, 1: right eye, 2: background)."
	},
	0xe5: {
		name: "TrackPlaneUID",
		level: 6,
		type: "u",
		mandatory: true,
		minver: 3,
		webm: false,
		range: "not 0",
		description: "The trackUID number of the track representing the plane."
	},
	0xe4: {
		name: "TrackPlane",
		level: 5,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 3,
		webm: false,
		description: "Contains a video plane track that need to be combined to create this 3D track"
	},
	0xe3: {
		name: "TrackCombinePlanes",
		level: 4,
		type: "m",
		minver: 3,
		webm: false,
		description: "Contains the list of all video plane tracks that need to be combined to create this 3D track"
	},
	0xe2: {
		name: "TrackOperation",
		level: 3,
		type: "m",
		minver: 3,
		webm: false,
		description: "Operation that needs to be applied on tracks to create this virtual track. For more details look at the Specification Notes on the subject."
	},
	0x7d7b: {
		name: "ChannelPositions",
		cppname: "AudioPosition",
		level: 4,
		type: "b",
		webm: false,
		description: "Table of horizontal angles for each successive channel, see appendix."
	},
	0x9f: {
		name: "Channels",
		cppname: "AudioChannels",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		"default": 1,
		range: "not 0",
		description: "Numbers of channels in the track."
	},
	0x78b5: {
		name: "OutputSamplingFrequency",
		cppname: "AudioOutputSamplingFreq",
		level: 4,
		type: "f",
		minver: 1,
		"default": "Sampling Frequency",
		range: "> 0",
		description: "Real output sampling frequency in Hz (used for SBR techniques)."
	},
	0xb5: {
		name: "SamplingFrequency",
		cppname: "AudioSamplingFreq",
		level: 4,
		type: "f",
		mandatory: true,
		minver: 1,
		"default": 8000.0,
		range: "> 0",
		description: "Sampling frequency in Hz."
	},
	0xe1: {
		name: "Audio",
		cppname: "TrackAudio",
		level: 3,
		type: "m",
		minver: 1,
		description: "Audio settings."
	},
	0x2383e3: {
		name: "FrameRate",
		cppname: "VideoFrameRate",
		level: 4,
		type: "f",
		range: "> 0",
		"strong": "Informational",
		description: "Number of frames per second.  only."
	},
	0x2fb523: {
		name: "GammaValue",
		cppname: "VideoGamma",
		level: 4,
		type: "f",
		webm: false,
		range: "> 0",
		description: "Gamma Value."
	},
	0x2eb524: {
		name: "ColourSpace",
		cppname: "VideoColourSpace",
		level: 4,
		type: "b",
		minver: 1,
		webm: false,
		bytesize: 4,
		description: "Same value as in AVI (32 bits)."
	},
	0x54b3: {
		name: "AspectRatioType",
		cppname: "VideoAspectRatio",
		level: 4,
		type: "u",
		minver: 1,
		"default": 0,
		description: "Specify the possible modifications to the aspect ratio (0: free resizing, 1: keep aspect ratio, 2: fixed)."
	},
	0x54b2: {
		name: "DisplayUnit",
		cppname: "VideoDisplayUnit",
		level: 4,
		type: "u",
		minver: 1,
		"default": 0,
		description: "How DisplayWidth & DisplayHeight should be interpreted (0: pixels, 1: centimeters, 2: inches, 3: Display Aspect Ratio)."
	},
	0x54ba: {
		name: "DisplayHeight",
		cppname: "VideoDisplayHeight",
		level: 4,
		type: "u",
		minver: 1,
		"default": "PixelHeight",
		range: "not 0",
		description: "Height of the video frames to display. The default value is only valid when DisplayUnit is 0."
	},
	0x54b0: {
		name: "DisplayWidth",
		cppname: "VideoDisplayWidth",
		level: 4,
		type: "u",
		minver: 1,
		"default": "PixelWidth",
		range: "not 0",
		description: "Width of the video frames to display. The default value is only valid when DisplayUnit is 0."
	},
	0x54dd: {
		name: "PixelCropRight",
		cppname: "VideoPixelCropRight",
		level: 4,
		type: "u",
		minver: 1,
		"default": 0,
		description: "The number of video pixels to remove on the right of the image."
	},
	0x54cc: {
		name: "PixelCropLeft",
		cppname: "VideoPixelCropLeft",
		level: 4,
		type: "u",
		minver: 1,
		"default": 0,
		description: "The number of video pixels to remove on the left of the image."
	},
	0x54bb: {
		name: "PixelCropTop",
		cppname: "VideoPixelCropTop",
		level: 4,
		type: "u",
		minver: 1,
		"default": 0,
		description: "The number of video pixels to remove at the top of the image."
	},
	0x54aa: {
		name: "PixelCropBottom",
		cppname: "VideoPixelCropBottom",
		level: 4,
		type: "u",
		minver: 1,
		"default": 0,
		description: "The number of video pixels to remove at the bottom of the image (for HDTV content)."
	},
	0xba: {
		name: "PixelHeight",
		cppname: "VideoPixelHeight",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		range: "not 0",
		description: "Height of the encoded video frames in pixels."
	},
	0xb0: {
		name: "PixelWidth",
		cppname: "VideoPixelWidth",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		range: "not 0",
		description: "Width of the encoded video frames in pixels."
	},
	0x53b9: {
		name: "OldStereoMode",
		level: 4,
		type: "u",
		"maxver": "0",
		webm: false,
		divx: false,
		description: "DEPRECATED, DO NOT USE. Bogus StereoMode value used in old versions of libmatroska. (0: mono, 1: right eye, 2: left eye, 3: both eyes)."
	},
	0x53c0: {
		name: "AlphaMode",
		cppname: "VideoAlphaMode",
		level: 4,
		type: "u",
		minver: 3,
		webm: true,
		"default": 0,
		description: "Alpha Video Mode. Presence of this element indicates that the BlockAdditional element could contain Alpha data."
	},
	0x53b8: {
		name: "StereoMode",
		cppname: "VideoStereoMode",
		level: 4,
		type: "u",
		minver: 3,
		webm: true,
		"default": 0,
		description: "Stereo-3D video mode (0: mono, 1: side by side (left eye is first), 2: top-bottom (right eye is first), 3: top-bottom (left eye is first), 4: checkboard (right is first), 5: checkboard (left is first), 6: row interleaved (right is first), 7: row interleaved (left is first), 8: column interleaved (right is first), 9: column interleaved (left is first), 10: anaglyph (cyan/red), 11: side by side (right eye is first), 12: anaglyph (green/magenta), 13 both eyes laced in one Block (left eye is first), 14 both eyes laced in one Block (right eye is first)) . There are some more details on 3D support in the Specification Notes."
	},
	0x9a: {
		name: "FlagInterlaced",
		cppname: "VideoFlagInterlaced",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 2,
		webm: true,
		"default": 0,
		range: "0-1",
		description: "Set if the video is interlaced. (1 bit)"
	},
	0xe0: {
		name: "Video",
		cppname: "TrackVideo",
		level: 3,
		type: "m",
		minver: 1,
		description: "Video settings."
	},
	0x66a5: {
		name: "TrackTranslateTrackID",
		level: 4,
		type: "b",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "The binary value used to represent this track in the chapter codec data. The format depends on the ChapProcessCodecID used."
	},
	0x66bf: {
		name: "TrackTranslateCodec",
		level: 4,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "The chapter codec using this ID (0: Matroska Script, 1: DVD-menu)."
	},
	0x66fc: {
		name: "TrackTranslateEditionUID",
		level: 4,
		type: "u",
		multiple: true,
		minver: 1,
		webm: false,
		description: "Specify an edition UID on which this translation applies. When not specified, it means for all editions found in the segment."
	},
	0x56bb: {
		name: "SeekPreRoll",
		level: 3,
		type: "u",
		mandatory: true,
		multiple: false,
		"default": 0,
		minver: 4,
		webm: true,
		description: "After a discontinuity, SeekPreRoll is the duration in nanoseconds of the data the decoder must decode before the decoded data is valid."
	},
	0x56aa: {
		name: "CodecDelay",
		level: 3,
		type: "u",
		multiple: false,
		"default": 0,
		minver: 4,
		webm: true,
		description: "CodecDelay is The codec-built-in delay in nanoseconds. This value must be subtracted from each block timestamp in order to get the actual timestamp. The value should be small so the muxing of tracks with the same actual timestamp are in the same Cluster."
	},
	0x6fab: {
		name: "TrackOverlay",
		level: 3,
		type: "u",
		multiple: true,
		minver: 1,
		webm: false,
		description: "Specify that this track is an overlay track for the Track specified (in the u-integer). That means when this track has a gap (see SilentTracks) the overlay track should be used instead. The order of multiple TrackOverlay matters, the first one is the one that should be used. If not found it should be the second, etc."
	},
	0xaa: {
		name: "CodecDecodeAll",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 2,
		webm: false,
		"default": 1,
		range: "0-1",
		description: "The codec can decode potentially damaged data (1 bit)."
	},
	0x26b240: {
		name: "CodecDownloadURL",
		level: 3,
		type: "s",
		multiple: true,
		webm: false,
		description: "A URL to download about the codec used."
	},
	0x3b4040: {
		name: "CodecInfoURL",
		level: 3,
		type: "s",
		multiple: true,
		webm: false,
		description: "A URL to find information about the codec used."
	},
	0x3a9697: {
		name: "CodecSettings",
		level: 3,
		type: "8",
		webm: false,
		description: "A string describing the encoding setting used."
	},
	0x63a2: {
		name: "CodecPrivate",
		level: 3,
		type: "b",
		minver: 1,
		description: "Private data only known to the codec."
	},
	0x22b59c: {
		name: "Language",
		cppname: "TrackLanguage",
		level: 3,
		type: "s",
		minver: 1,
		"default": "eng",
		description: "Specifies the language of the track in the Matroska languages form."
	},
	0x536e: {
		name: "Name",
		cppname: "TrackName",
		level: 3,
		type: "8",
		minver: 1,
		description: "A human-readable track name."
	},
	0x55ee: {
		name: "MaxBlockAdditionID",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "The maximum value of BlockAdditions for this track."
	},
	0x537f: {
		name: "TrackOffset",
		level: 3,
		type: "i",
		webm: false,
		"default": 0,
		description: "A value to add to the Block's Timestamp. This can be used to adjust the playback offset of a track."
	},
	0x23314f: {
		name: "TrackTimecodeScale",
		level: 3,
		type: "f",
		mandatory: true,
		minver: 1,
		"maxver": "3",
		webm: false,
		"default": 1.0,
		range: "> 0",
		description: "DEPRECATED, DO NOT USE. The scale to apply on this track to work at normal speed in relation with other tracks (mostly used to adjust video speed when the audio length differs)."
	},
	0x234e7a: {
		name: "DefaultDecodedFieldDuration",
		cppname: "TrackDefaultDecodedFieldDuration",
		level: 3,
		type: "u",
		minver: 4,
		range: "not 0",
		description: "The period in nanoseconds (not scaled by TimcodeScale)\nbetween two successive fields at the output of the decoding process (see the notes)"
	},
	0x23e383: {
		name: "DefaultDuration",
		cppname: "TrackDefaultDuration",
		level: 3,
		type: "u",
		minver: 1,
		range: "not 0",
		description: "Number of nanoseconds (not scaled via TimecodeScale) per frame ('frame' in the Matroska sense -- one element put into a (Simple)Block)."
	},
	0x6df8: {
		name: "MaxCache",
		cppname: "TrackMaxCache",
		level: 3,
		type: "u",
		minver: 1,
		webm: false,
		description: "The maximum cache size required to store referenced frames in and the current frame. 0 means no cache is needed."
	},
	0x6de7: {
		name: "MinCache",
		cppname: "TrackMinCache",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "The minimum number of frames a player should be able to cache during playback. If set to 0, the reference pseudo-cache system is not used."
	},
	0x9c: {
		name: "FlagLacing",
		cppname: "TrackFlagLacing",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		"default": 1,
		range: "0-1",
		description: "Set if the track may contain blocks using lacing. (1 bit)"
	},
	0x55aa: {
		name: "FlagForced",
		cppname: "TrackFlagForced",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		"default": 0,
		range: "0-1",
		description: "Set if that track MUST be active during playback. There can be many forced track for a kind (audio, video or subs), the player should select the one which language matches the user preference or the default + forced track. Overlay MAY happen between a forced and non-forced track of the same kind. (1 bit)"
	},
	0xb9: {
		name: "FlagEnabled",
		cppname: "TrackFlagEnabled",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 2,
		webm: true,
		"default": 1,
		range: "0-1",
		description: "Set if the track is usable. (1 bit)"
	},
	0x73c5: {
		name: "TrackUID",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		range: "not 0",
		description: "A unique ID to identify the Track. This should be kept the same when making a direct stream copy of the Track to another file."
	},
	0xd7: {
		name: "TrackNumber",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		range: "not 0",
		description: "The track number as used in the Block Header (using more than 127 tracks is not encouraged, though the design allows an unlimited number)."
	},
	0xae: {
		name: "TrackEntry",
		level: 2,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		description: "Describes a track with all elements."
	},
	0x1654ae6b: {
		name: "Tracks",
		level: 1,
		type: "m",
		multiple: true,
		minver: 1,
		description: "A top-level block of information with many tracks described."
	},
	0xaf: {
		name: "EncryptedBlock",
		level: 2,
		type: "b",
		multiple: true,
		webm: false,
		description: "Similar to EncryptedBlock Structure)"
	},
	0xca: {
		name: "ReferenceTimeCode",
		level: 4,
		type: "u",
		multiple: false,
		mandatory: true,
		minver: 0,
		webm: false,
		divx: true,
		description: "DivX trick track extenstions"
	},
	0xc9: {
		name: "ReferenceOffset",
		level: 4,
		type: "u",
		multiple: false,
		mandatory: true,
		minver: 0,
		webm: false,
		divx: true,
		description: "DivX trick track extenstions"
	},
	0xc8: {
		name: "ReferenceFrame",
		level: 3,
		type: "m",
		multiple: false,
		minver: 0,
		webm: false,
		divx: true,
		description: "DivX trick track extenstions"
	},
	0xcf: {
		name: "SliceDuration",
		level: 5,
		type: "u",
		"default": 0,
		description: "The (scaled) duration to apply to the element."
	},
	0xce: {
		name: "Delay",
		cppname: "SliceDelay",
		level: 5,
		type: "u",
		"default": 0,
		description: "The (scaled) delay to apply to the element."
	},
	0xcb: {
		name: "BlockAdditionID",
		cppname: "SliceBlockAddID",
		level: 5,
		type: "u",
		"default": 0,
		description: "The ID of the BlockAdditional element (0 is the main Block)."
	},
	0xcd: {
		name: "FrameNumber",
		cppname: "SliceFrameNumber",
		level: 5,
		type: "u",
		"default": 0,
		description: "The number of the frame to generate from this lace with this delay (allow you to generate many frames from the same Block/Frame)."
	},
	0xcc: {
		name: "LaceNumber",
		cppname: "SliceLaceNumber",
		level: 5,
		type: "u",
		minver: 1,
		"default": 0,
		divx: false,
		description: "The reverse number of the frame in the lace (0 is the last frame, 1 is the next to last, etc). While there are a few files in the wild with this element, it is no longer in use and has been deprecated. Being able to interpret this element is not required for playback."
	},
	0xe8: {
		name: "TimeSlice",
		level: 4,
		type: "m",
		multiple: true,
		minver: 1,
		divx: false,
		description: "Contains extra time information about the data contained in the Block. While there are a few files in the wild with this element, it is no longer in use and has been deprecated. Being able to interpret this element is not required for playback."
	},
	0x8e: {
		name: "Slices",
		level: 3,
		type: "m",
		minver: 1,
		divx: false,
		description: "Contains slices description."
	},
	0x75a2: {
		name: "DiscardPadding",
		level: 3,
		type: "i",
		minver: 4,
		webm: true,
		description: "Duration in nanoseconds of the silent data added to the Block (padding at the end of the Block for positive value, at the beginning of the Block for negative value). The duration of DiscardPadding is not calculated in the duration of the TrackEntry and should be discarded during playback."
	},
	0xa4: {
		name: "CodecState",
		level: 3,
		type: "b",
		minver: 2,
		webm: false,
		description: "The new codec state to use. Data interpretation is private to the codec. This information should always be referenced by a seek entry."
	},
	0xfd: {
		name: "ReferenceVirtual",
		level: 3,
		type: "i",
		webm: false,
		description: "Relative position of the data that should be in position of the virtual block."
	},
	0xfb: {
		name: "ReferenceBlock",
		level: 3,
		type: "i",
		multiple: true,
		minver: 1,
		description: "Timestamp of another frame used as a reference (ie: B or P frame). The timestamp is relative to the block it's attached to."
	},
	0xfa: {
		name: "ReferencePriority",
		cppname: "FlagReferenced",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 0,
		description: "This frame is referenced and has the specified cache priority. In cache only a frame of the same or higher priority can replace this frame. A value of 0 means the frame is not referenced."
	},
	0x9b: {
		name: "BlockDuration",
		level: 3,
		type: "u",
		minver: 1,
		"default": "TrackDuration",
		description: "The duration of the Block (based on TimecodeScale). This element is mandatory when DefaultDuration is set for the track (but can be omitted as other default values). When not written and with no DefaultDuration, the value is assumed to be the difference between the timestamp of this Block and the timestamp of the next Block in \"display\" order (not coding order). This element can be useful at the end of a Track (as there is not other Block available), or when there is a break in a track like for subtitle tracks. When set to 0 that means the frame is not a keyframe."
	},
	0xa5: {
		name: "BlockAdditional",
		level: 5,
		type: "b",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "Interpreted by the codec as it wishes (using the BlockAddID)."
	},
	0xee: {
		name: "BlockAddID",
		level: 5,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		"default": 1,
		range: "not 0",
		description: "An ID to identify the BlockAdditional level."
	},
	0xa6: {
		name: "BlockMore",
		level: 4,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		webm: false,
		description: "Contain the BlockAdditional and some parameters."
	},
	0x75a1: {
		name: "BlockAdditions",
		level: 3,
		type: "m",
		minver: 1,
		webm: false,
		description: "Contain additional blocks to complete the main one. An EBML parser that has no knowledge of the Block structure could still see and use/skip these data."
	},
	0xa2: {
		name: "BlockVirtual",
		level: 3,
		type: "b",
		webm: false,
		description: "A Block with no data. It must be stored in the stream at the place the real Block should be in display order. (see Block Virtual)"
	},
	0xa1: {
		name: "Block",
		level: 3,
		type: "b",
		mandatory: true,
		minver: 1,
		description: "Block containing the actual data to be rendered and a timestamp relative to the Cluster Timecode. (see Block Structure)"
	},
	0xa0: {
		name: "BlockGroup",
		level: 2,
		type: "m",
		multiple: true,
		minver: 1,
		description: "Basic container of information containing a single Block or BlockVirtual, and information specific to that Block/VirtualBlock."
	},
	0xa3: {
		name: "SimpleBlock",
		level: 2,
		type: "b",
		multiple: true,
		minver: 2,
		webm: true,
		divx: true,
		description: "Similar to SimpleBlock Structure"
	},
	0xab: {
		name: "PrevSize",
		cppname: "ClusterPrevSize",
		level: 2,
		type: "u",
		minver: 1,
		description: "Size of the previous Cluster, in octets. Can be useful for backward playing.",
		position: "prevCluster"
	},
	0xa7: {
		name: "Position",
		cppname: "ClusterPosition",
		level: 2,
		type: "u",
		minver: 1,
		webm: false,
		description: "The Position of the Cluster in the segment (0 in live broadcast streams). It might help to resynchronise offset on damaged streams.",
		position: "segment"
	},
	0x58d7: {
		name: "SilentTrackNumber",
		cppname: "ClusterSilentTrackNumber",
		level: 3,
		type: "u",
		multiple: true,
		minver: 1,
		webm: false,
		description: "One of the track number that are not used from now on in the stream. It could change later if not specified as silent in a further Cluster."
	},
	0xe7: {
		name: "Timecode",
		cppname: "ClusterTimecode",
		level: 2,
		type: "u",
		mandatory: true,
		minver: 1,
		description: "Absolute timestamp of the cluster (based on TimecodeScale)."
	},
	0x1f43b675: {
		name: "Cluster",
		level: 1,
		type: "m",
		multiple: true,
		minver: 1,
		description: "The lower level element containing the (monolithic) Block structure."
	},
	0x4d80: {
		name: "MuxingApp",
		level: 2,
		type: "8",
		mandatory: true,
		minver: 1,
		description: "Muxing application or library (\"libmatroska-0.4.3\")."
	},
	0x7ba9: {
		name: "Title",
		level: 2,
		type: "8",
		minver: 1,
		webm: false,
		description: "General name of the segment."
	},
	0x2ad7b2: {
		name: "TimecodeScaleDenominator",
		level: 2,
		type: "u",
		mandatory: true,
		minver: 4,
		"default": "1000000000",
		description: "Timestamp scale numerator, see TimecodeScale."
	},
	0x2ad7b1: {
		name: "TimecodeScale",
		level: 2,
		type: "u",
		mandatory: true,
		minver: 1,
		"default": "1000000",
		description: "Timestamp scale in nanoseconds (1.000.000 means all timestamps in the segment are expressed in milliseconds)."
	},
	0x69a5: {
		name: "ChapterTranslateID",
		level: 3,
		type: "b",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "The binary value used to represent this segment in the chapter codec data. The format depends on the ChapProcessCodecID used."
	},
	0x69bf: {
		name: "ChapterTranslateCodec",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		webm: false,
		description: "The chapter codec using this ID (0: Matroska Script, 1: DVD-menu)."
	},
	0x69fc: {
		name: "ChapterTranslateEditionUID",
		level: 3,
		type: "u",
		multiple: true,
		minver: 1,
		webm: false,
		description: "Specify an edition UID on which this correspondance applies. When not specified, it means for all editions found in the segment."
	},
	0x3e83bb: {
		name: "NextFilename",
		level: 2,
		type: "8",
		minver: 1,
		webm: false,
		description: "An escaped filename corresponding to the next segment."
	},
	0x3eb923: {
		name: "NextUID",
		level: 2,
		type: "b",
		minver: 1,
		webm: false,
		bytesize: 16,
		description: "A unique ID to identify the next chained segment (128 bits)."
	},
	0x3c83ab: {
		name: "PrevFilename",
		level: 2,
		type: "8",
		minver: 1,
		webm: false,
		description: "An escaped filename corresponding to the previous segment."
	},
	0x3cb923: {
		name: "PrevUID",
		level: 2,
		type: "b",
		minver: 1,
		webm: false,
		bytesize: 16,
		description: "A unique ID to identify the previous chained segment (128 bits)."
	},
	0x73a4: {
		name: "SegmentUID",
		level: 2,
		type: "b",
		minver: 1,
		webm: false,
		range: "not 0",
		bytesize: 16,
		description: "A randomly generated unique ID to identify the current segment between many others (128 bits)."
	},
	0x1549a966: {
		name: "Info",
		level: 1,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		description: "Contains miscellaneous general information and statistics on the file."
	},
	0x53ac: {
		name: "SeekPosition",
		level: 3,
		type: "u",
		mandatory: true,
		minver: 1,
		description: "The position of the element in the segment in octets (0 = first level 1 element).",
		position: "segment"
	},
	0x53ab: {
		name: "SeekID",
		level: 3,
		type: "b",
		mandatory: true,
		minver: 1,
		description: "The binary ID corresponding to the element name.",
		type2: "ebmlID"
	},
	0x4dbb: {
		name: "Seek",
		cppname: "SeekPoint",
		level: 2,
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		description: "Contains a single seek entry to an EBML element."
	},
	0x114d9b74: {
		name: "SeekHead",
		cppname: "SeekHeader",
		level: 1,
		type: "m",
		multiple: true,
		minver: 1,
		description: "Contains the position of other level 1 elements."
	},
	0x7e7b: {
		name: "SignatureElementList",
		level: 2,
		type: "m",
		multiple: true,
		webm: false,
		i: "Cluster|Block|BlockAdditional",
		description: "A list consists of a number of consecutive elements that represent one case where data is used in signature. Ex:  means that the BlockAdditional of all Blocks in all Clusters is used for encryption."
	},
	0x7e5b: {
		name: "SignatureElements",
		level: 1,
		type: "m",
		webm: false,
		description: "Contains elements that will be used to compute the signature."
	},
	0x7eb5: {
		name: "Signature",
		level: 1,
		type: "b",
		webm: false,
		description: "The signature of the data (until a new."
	},
	0x7ea5: {
		name: "SignaturePublicKey",
		level: 1,
		type: "b",
		webm: false,
		description: "The public key to use with the algorithm (in the case of a PKI-based signature)."
	},
	0x7e9a: {
		name: "SignatureHash",
		level: 1,
		type: "u",
		webm: false,
		description: "Hash algorithm used (1=SHA1-160, 2=MD5)."
	},
	0x7e8a: {
		name: "SignatureAlgo",
		level: 1,
		type: "u",
		webm: false,
		description: "Signature algorithm used (1=RSA, 2=elliptic)."
	},
	0x1b538667: {
		name: "SignatureSlot",
		level: -1,
		type: "m",
		multiple: true,
		webm: false,
		description: "Contain signature of some (coming) elements in the stream."
	},
	0xbf: {
		name: "CRC-32",
		level: -1,
		type: "b",
		minver: 1,
		webm: false,
		description: "The CRC is computed on all the data of the Master element it's in. The CRC element should be the first in it's parent master for easier reading. All level 1 elements should include a CRC-32. The CRC in use is the IEEE CRC32 Little Endian",
		crc: true
	},
	0xec: {
		name: "Void",
		level: -1,
		type: "b",
		minver: 1,
		description: "Used to void damaged data, to avoid unexpected behaviors when using damaged data. The content is discarded. Also used to reserve space in a sub-element for later use."
	},
	0x42f3: {
		name: "EBMLMaxSizeLength",
		level: 1,
		type: "u",
		mandatory: true,
		"default": 8,
		minver: 1,
		description: "The maximum length of the sizes you'll find in this file (8 or less in Matroska). This does not override the element size indicated at the beginning of an element. Elements that have an indicated size which is larger than what is allowed by EBMLMaxSizeLength shall be considered invalid."
	},
	0x42f2: {
		name: "EBMLMaxIDLength",
		level: 1,
		type: "u",
		mandatory: true,
		"default": 4,
		minver: 1,
		description: "The maximum length of the IDs you'll find in this file (4 or less in Matroska)."
	},
	0x42f7: {
		name: "EBMLReadVersion",
		level: 1,
		type: "u",
		mandatory: true,
		"default": 1,
		minver: 1,
		description: "The minimum EBML version a parser has to support to read this file."
	},
	0x1a45dfa3: {
		name: "EBML",
		level: "0",
		type: "m",
		mandatory: true,
		multiple: true,
		minver: 1,
		description: "Set the EBML characteristics of the data to follow. Each EBML document has to start with this."
	}
};

var byName = {};

var schema = {
	byEbmlID: byEbmlID,
	byName: byName
}

for ( var ebmlID in byEbmlID) {
	var desc = byEbmlID[ebmlID];
	byName[desc.name.replace('-', '_')] = parseInt(ebmlID, 10);
}

module.exports = schema;

},{}],29:[function(require,module,exports){
/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} [options]
 * @throws {Error} throw an error if val is not a non-empty string or a number
 * @return {String|Number}
 * @api public
 */

module.exports = function(val, options) {
  options = options || {};
  var type = typeof val;
  if (type === 'string' && val.length > 0) {
    return parse(val);
  } else if (type === 'number' && isNaN(val) === false) {
    return options.long ? fmtLong(val) : fmtShort(val);
  }
  throw new Error(
    'val is not a non-empty string or a valid number. val=' +
      JSON.stringify(val)
  );
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  str = String(str);
  if (str.length > 100) {
    return;
  }
  var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(
    str
  );
  if (!match) {
    return;
  }
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
    default:
      return undefined;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtShort(ms) {
  if (ms >= d) {
    return Math.round(ms / d) + 'd';
  }
  if (ms >= h) {
    return Math.round(ms / h) + 'h';
  }
  if (ms >= m) {
    return Math.round(ms / m) + 'm';
  }
  if (ms >= s) {
    return Math.round(ms / s) + 's';
  }
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtLong(ms) {
  return plural(ms, d, 'day') ||
    plural(ms, h, 'hour') ||
    plural(ms, m, 'minute') ||
    plural(ms, s, 'second') ||
    ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, n, name) {
  if (ms < n) {
    return;
  }
  if (ms < n * 1.5) {
    return Math.floor(ms / n) + ' ' + name;
  }
  return Math.ceil(ms / n) + ' ' + name + 's';
}

},{}],30:[function(require,module,exports){
(function (process){
'use strict';

if (typeof process === 'undefined' ||
    !process.version ||
    process.version.indexOf('v0.') === 0 ||
    process.version.indexOf('v1.') === 0 && process.version.indexOf('v1.8.') !== 0) {
  module.exports = { nextTick: nextTick };
} else {
  module.exports = process
}

function nextTick(fn, arg1, arg2, arg3) {
  if (typeof fn !== 'function') {
    throw new TypeError('"callback" argument must be a function');
  }
  var len = arguments.length;
  var args, i;
  switch (len) {
  case 0:
  case 1:
    return process.nextTick(fn);
  case 2:
    return process.nextTick(function afterTickOne() {
      fn.call(null, arg1);
    });
  case 3:
    return process.nextTick(function afterTickTwo() {
      fn.call(null, arg1, arg2);
    });
  case 4:
    return process.nextTick(function afterTickThree() {
      fn.call(null, arg1, arg2, arg3);
    });
  default:
    args = new Array(len - 1);
    i = 0;
    while (i < args.length) {
      args[i++] = arguments[i];
    }
    return process.nextTick(function afterTick() {
      fn.apply(null, args);
    });
  }
}


}).call(this,require('_process'))
},{"_process":31}],31:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],32:[function(require,module,exports){
module.exports = require('./lib/_stream_duplex.js');

},{"./lib/_stream_duplex.js":33}],33:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

'use strict';

/*<replacement>*/

var pna = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    keys.push(key);
  }return keys;
};
/*</replacement>*/

module.exports = Duplex;

/*<replacement>*/
var util = Object.create(require('core-util-is'));
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

{
  // avoid scope creep, the keys array can then be collected
  var keys = objectKeys(Writable.prototype);
  for (var v = 0; v < keys.length; v++) {
    var method = keys[v];
    if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
  }
}

function Duplex(options) {
  if (!(this instanceof Duplex)) return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false) this.readable = false;

  if (options && options.writable === false) this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;

  this.once('end', onend);
}

Object.defineProperty(Duplex.prototype, 'writableHighWaterMark', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function () {
    return this._writableState.highWaterMark;
  }
});

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended) return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  pna.nextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

Object.defineProperty(Duplex.prototype, 'destroyed', {
  get: function () {
    if (this._readableState === undefined || this._writableState === undefined) {
      return false;
    }
    return this._readableState.destroyed && this._writableState.destroyed;
  },
  set: function (value) {
    // we ignore the value if the stream
    // has not been initialized yet
    if (this._readableState === undefined || this._writableState === undefined) {
      return;
    }

    // backward compatibility, the user is explicitly
    // managing destroyed
    this._readableState.destroyed = value;
    this._writableState.destroyed = value;
  }
});

Duplex.prototype._destroy = function (err, cb) {
  this.push(null);
  this.end();

  pna.nextTick(cb, err);
};
},{"./_stream_readable":35,"./_stream_writable":37,"core-util-is":11,"inherits":24,"process-nextick-args":30}],34:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

'use strict';

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = Object.create(require('core-util-is'));
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough)) return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function (chunk, encoding, cb) {
  cb(null, chunk);
};
},{"./_stream_transform":36,"core-util-is":11,"inherits":24}],35:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

/*<replacement>*/

var pna = require('process-nextick-args');
/*</replacement>*/

module.exports = Readable;

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/

/*<replacement>*/
var Duplex;
/*</replacement>*/

Readable.ReadableState = ReadableState;

/*<replacement>*/
var EE = require('events').EventEmitter;

var EElistenerCount = function (emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

/*<replacement>*/
var Stream = require('./internal/streams/stream');
/*</replacement>*/

/*<replacement>*/

var Buffer = require('safe-buffer').Buffer;
var OurUint8Array = global.Uint8Array || function () {};
function _uint8ArrayToBuffer(chunk) {
  return Buffer.from(chunk);
}
function _isUint8Array(obj) {
  return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
}

/*</replacement>*/

/*<replacement>*/
var util = Object.create(require('core-util-is'));
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var debugUtil = require('util');
var debug = void 0;
if (debugUtil && debugUtil.debuglog) {
  debug = debugUtil.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/

var BufferList = require('./internal/streams/BufferList');
var destroyImpl = require('./internal/streams/destroy');
var StringDecoder;

util.inherits(Readable, Stream);

var kProxyEvents = ['error', 'close', 'destroy', 'pause', 'resume'];

function prependListener(emitter, event, fn) {
  // Sadly this is not cacheable as some libraries bundle their own
  // event emitter implementation with them.
  if (typeof emitter.prependListener === 'function') return emitter.prependListener(event, fn);

  // This is a hack to make sure that our error handler is attached before any
  // userland ones.  NEVER DO THIS. This is here only because this code needs
  // to continue to work with older versions of Node.js that do not include
  // the prependListener() method. The goal is to eventually remove this hack.
  if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);else if (isArray(emitter._events[event])) emitter._events[event].unshift(fn);else emitter._events[event] = [fn, emitter._events[event]];
}

function ReadableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // Duplex streams are both readable and writable, but share
  // the same options object.
  // However, some cases require setting options to different
  // values for the readable and the writable sides of the duplex stream.
  // These options can be provided separately as readableXXX and writableXXX.
  var isDuplex = stream instanceof Duplex;

  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (isDuplex) this.objectMode = this.objectMode || !!options.readableObjectMode;

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var readableHwm = options.readableHighWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;

  if (hwm || hwm === 0) this.highWaterMark = hwm;else if (isDuplex && (readableHwm || readableHwm === 0)) this.highWaterMark = readableHwm;else this.highWaterMark = defaultHwm;

  // cast to ints.
  this.highWaterMark = Math.floor(this.highWaterMark);

  // A linked list is used to store data chunks instead of an array because the
  // linked list can remove elements from the beginning faster than
  // array.shift()
  this.buffer = new BufferList();
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the event 'readable'/'data' is emitted
  // immediately, or on a later tick.  We set this to true at first, because
  // any actions that shouldn't happen until "later" should generally also
  // not happen before the first read call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;

  // has it been destroyed
  this.destroyed = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  if (!(this instanceof Readable)) return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  if (options) {
    if (typeof options.read === 'function') this._read = options.read;

    if (typeof options.destroy === 'function') this._destroy = options.destroy;
  }

  Stream.call(this);
}

Object.defineProperty(Readable.prototype, 'destroyed', {
  get: function () {
    if (this._readableState === undefined) {
      return false;
    }
    return this._readableState.destroyed;
  },
  set: function (value) {
    // we ignore the value if the stream
    // has not been initialized yet
    if (!this._readableState) {
      return;
    }

    // backward compatibility, the user is explicitly
    // managing destroyed
    this._readableState.destroyed = value;
  }
});

Readable.prototype.destroy = destroyImpl.destroy;
Readable.prototype._undestroy = destroyImpl.undestroy;
Readable.prototype._destroy = function (err, cb) {
  this.push(null);
  cb(err);
};

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function (chunk, encoding) {
  var state = this._readableState;
  var skipChunkCheck;

  if (!state.objectMode) {
    if (typeof chunk === 'string') {
      encoding = encoding || state.defaultEncoding;
      if (encoding !== state.encoding) {
        chunk = Buffer.from(chunk, encoding);
        encoding = '';
      }
      skipChunkCheck = true;
    }
  } else {
    skipChunkCheck = true;
  }

  return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function (chunk) {
  return readableAddChunk(this, chunk, null, true, false);
};

function readableAddChunk(stream, chunk, encoding, addToFront, skipChunkCheck) {
  var state = stream._readableState;
  if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else {
    var er;
    if (!skipChunkCheck) er = chunkInvalid(state, chunk);
    if (er) {
      stream.emit('error', er);
    } else if (state.objectMode || chunk && chunk.length > 0) {
      if (typeof chunk !== 'string' && !state.objectMode && Object.getPrototypeOf(chunk) !== Buffer.prototype) {
        chunk = _uint8ArrayToBuffer(chunk);
      }

      if (addToFront) {
        if (state.endEmitted) stream.emit('error', new Error('stream.unshift() after end event'));else addChunk(stream, state, chunk, true);
      } else if (state.ended) {
        stream.emit('error', new Error('stream.push() after EOF'));
      } else {
        state.reading = false;
        if (state.decoder && !encoding) {
          chunk = state.decoder.write(chunk);
          if (state.objectMode || chunk.length !== 0) addChunk(stream, state, chunk, false);else maybeReadMore(stream, state);
        } else {
          addChunk(stream, state, chunk, false);
        }
      }
    } else if (!addToFront) {
      state.reading = false;
    }
  }

  return needMoreData(state);
}

function addChunk(stream, state, chunk, addToFront) {
  if (state.flowing && state.length === 0 && !state.sync) {
    stream.emit('data', chunk);
    stream.read(0);
  } else {
    // update the buffer info.
    state.length += state.objectMode ? 1 : chunk.length;
    if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);

    if (state.needReadable) emitReadable(stream);
  }
  maybeReadMore(stream, state);
}

function chunkInvalid(state, chunk) {
  var er;
  if (!_isUint8Array(chunk) && typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}

// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
}

Readable.prototype.isPaused = function () {
  return this._readableState.flowing === false;
};

// backwards compatibility.
Readable.prototype.setEncoding = function (enc) {
  if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 8MB
var MAX_HWM = 0x800000;
function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2 to prevent increasing hwm excessively in
    // tiny amounts
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}

// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function howMuchToRead(n, state) {
  if (n <= 0 || state.length === 0 && state.ended) return 0;
  if (state.objectMode) return 1;
  if (n !== n) {
    // Only flow one buffer at a time
    if (state.flowing && state.length) return state.buffer.head.data.length;else return state.length;
  }
  // If we're asking for more than the current hwm, then raise the hwm.
  if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
  if (n <= state.length) return n;
  // Don't have enough
  if (!state.ended) {
    state.needReadable = true;
    return 0;
  }
  return state.length;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function (n) {
  debug('read', n);
  n = parseInt(n, 10);
  var state = this._readableState;
  var nOrig = n;

  if (n !== 0) state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0) endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  } else if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0) state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
    // If _read pushed data synchronously, then `reading` will be false,
    // and we need to re-evaluate how much data we can return to the user.
    if (!state.reading) n = howMuchToRead(nOrig, state);
  }

  var ret;
  if (n > 0) ret = fromList(n, state);else ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  } else {
    state.length -= n;
  }

  if (state.length === 0) {
    // If we have nothing in the buffer, then we want to know
    // as soon as we *do* get something into the buffer.
    if (!state.ended) state.needReadable = true;

    // If we tried to read() past the EOF, then emit end on the next tick.
    if (nOrig !== n && state.ended) endReadable(this);
  }

  if (ret !== null) this.emit('data', ret);

  return ret;
};

function onEofChunk(stream, state) {
  if (state.ended) return;
  if (state.decoder) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync) pna.nextTick(emitReadable_, stream);else emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}

// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    pna.nextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;else len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function (n) {
  this.emit('error', new Error('_read() is not implemented'));
};

Readable.prototype.pipe = function (dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;

  var endFn = doEnd ? onend : unpipe;
  if (state.endEmitted) pna.nextTick(endFn);else src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable, unpipeInfo) {
    debug('onunpipe');
    if (readable === src) {
      if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
        unpipeInfo.hasUnpiped = true;
        cleanup();
      }
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  var cleanedUp = false;
  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', unpipe);
    src.removeListener('data', ondata);

    cleanedUp = true;

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
  }

  // If the user pushes more data while we're writing to dest then we'll end up
  // in ondata again. However, we only want to increase awaitDrain once because
  // dest will only emit one 'drain' event for the multiple writes.
  // => Introduce a guard on increasing awaitDrain.
  var increasedAwaitDrain = false;
  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    increasedAwaitDrain = false;
    var ret = dest.write(chunk);
    if (false === ret && !increasedAwaitDrain) {
      // If the user unpiped during `dest.write()`, it is possible
      // to get stuck in a permanently paused state if that write
      // also returned false.
      // => Check whether `dest` is still a piping destination.
      if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
        debug('false write response, pause', src._readableState.awaitDrain);
        src._readableState.awaitDrain++;
        increasedAwaitDrain = true;
      }
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EElistenerCount(dest, 'error') === 0) dest.emit('error', er);
  }

  // Make sure our error handler is attached before userland ones.
  prependListener(dest, 'error', onerror);

  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function () {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain) state.awaitDrain--;
    if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}

Readable.prototype.unpipe = function (dest) {
  var state = this._readableState;
  var unpipeInfo = { hasUnpiped: false };

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0) return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes) return this;

    if (!dest) dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest) dest.emit('unpipe', this, unpipeInfo);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++) {
      dests[i].emit('unpipe', this, unpipeInfo);
    }return this;
  }

  // try to find the right one.
  var index = indexOf(state.pipes, dest);
  if (index === -1) return this;

  state.pipes.splice(index, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1) state.pipes = state.pipes[0];

  dest.emit('unpipe', this, unpipeInfo);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function (ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  if (ev === 'data') {
    // Start flowing on next tick if stream isn't explicitly paused
    if (this._readableState.flowing !== false) this.resume();
  } else if (ev === 'readable') {
    var state = this._readableState;
    if (!state.endEmitted && !state.readableListening) {
      state.readableListening = state.needReadable = true;
      state.emittedReadable = false;
      if (!state.reading) {
        pna.nextTick(nReadingNextTick, this);
      } else if (state.length) {
        emitReadable(this);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function () {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    pna.nextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  if (!state.reading) {
    debug('resume read 0');
    stream.read(0);
  }

  state.resumeScheduled = false;
  state.awaitDrain = 0;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading) stream.read(0);
}

Readable.prototype.pause = function () {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  while (state.flowing && stream.read() !== null) {}
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function (stream) {
  var _this = this;

  var state = this._readableState;
  var paused = false;

  stream.on('end', function () {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) _this.push(chunk);
    }

    _this.push(null);
  });

  stream.on('data', function (chunk) {
    debug('wrapped data');
    if (state.decoder) chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

    var ret = _this.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function (method) {
        return function () {
          return stream[method].apply(stream, arguments);
        };
      }(i);
    }
  }

  // proxy certain important events.
  for (var n = 0; n < kProxyEvents.length; n++) {
    stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
  }

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  this._read = function (n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return this;
};

Object.defineProperty(Readable.prototype, 'readableHighWaterMark', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function () {
    return this._readableState.highWaterMark;
  }
});

// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromList(n, state) {
  // nothing buffered
  if (state.length === 0) return null;

  var ret;
  if (state.objectMode) ret = state.buffer.shift();else if (!n || n >= state.length) {
    // read it all, truncate the list
    if (state.decoder) ret = state.buffer.join('');else if (state.buffer.length === 1) ret = state.buffer.head.data;else ret = state.buffer.concat(state.length);
    state.buffer.clear();
  } else {
    // read part of list
    ret = fromListPartial(n, state.buffer, state.decoder);
  }

  return ret;
}

// Extracts only enough buffered data to satisfy the amount requested.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromListPartial(n, list, hasStrings) {
  var ret;
  if (n < list.head.data.length) {
    // slice is the same for buffers and strings
    ret = list.head.data.slice(0, n);
    list.head.data = list.head.data.slice(n);
  } else if (n === list.head.data.length) {
    // first chunk is a perfect match
    ret = list.shift();
  } else {
    // result spans more than one buffer
    ret = hasStrings ? copyFromBufferString(n, list) : copyFromBuffer(n, list);
  }
  return ret;
}

// Copies a specified amount of characters from the list of buffered data
// chunks.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function copyFromBufferString(n, list) {
  var p = list.head;
  var c = 1;
  var ret = p.data;
  n -= ret.length;
  while (p = p.next) {
    var str = p.data;
    var nb = n > str.length ? str.length : n;
    if (nb === str.length) ret += str;else ret += str.slice(0, n);
    n -= nb;
    if (n === 0) {
      if (nb === str.length) {
        ++c;
        if (p.next) list.head = p.next;else list.head = list.tail = null;
      } else {
        list.head = p;
        p.data = str.slice(nb);
      }
      break;
    }
    ++c;
  }
  list.length -= c;
  return ret;
}

// Copies a specified amount of bytes from the list of buffered data chunks.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function copyFromBuffer(n, list) {
  var ret = Buffer.allocUnsafe(n);
  var p = list.head;
  var c = 1;
  p.data.copy(ret);
  n -= p.data.length;
  while (p = p.next) {
    var buf = p.data;
    var nb = n > buf.length ? buf.length : n;
    buf.copy(ret, ret.length - n, 0, nb);
    n -= nb;
    if (n === 0) {
      if (nb === buf.length) {
        ++c;
        if (p.next) list.head = p.next;else list.head = list.tail = null;
      } else {
        list.head = p;
        p.data = buf.slice(nb);
      }
      break;
    }
    ++c;
  }
  list.length -= c;
  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0) throw new Error('"endReadable()" called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    pna.nextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  // Check that we didn't get one last unshift.
  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');
  }
}

function indexOf(xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}
}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./_stream_duplex":33,"./internal/streams/BufferList":38,"./internal/streams/destroy":39,"./internal/streams/stream":40,"_process":31,"core-util-is":11,"events":54,"inherits":24,"isarray":27,"process-nextick-args":30,"safe-buffer":41,"string_decoder/":42,"util":8}],36:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

'use strict';

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = Object.create(require('core-util-is'));
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);

function afterTransform(er, data) {
  var ts = this._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb) {
    return this.emit('error', new Error('write callback called multiple times'));
  }

  ts.writechunk = null;
  ts.writecb = null;

  if (data != null) // single equals check for both `null` and `undefined`
    this.push(data);

  cb(er);

  var rs = this._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    this._read(rs.highWaterMark);
  }
}

function Transform(options) {
  if (!(this instanceof Transform)) return new Transform(options);

  Duplex.call(this, options);

  this._transformState = {
    afterTransform: afterTransform.bind(this),
    needTransform: false,
    transforming: false,
    writecb: null,
    writechunk: null,
    writeencoding: null
  };

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function') this._transform = options.transform;

    if (typeof options.flush === 'function') this._flush = options.flush;
  }

  // When the writable side finishes, then flush out anything remaining.
  this.on('prefinish', prefinish);
}

function prefinish() {
  var _this = this;

  if (typeof this._flush === 'function') {
    this._flush(function (er, data) {
      done(_this, er, data);
    });
  } else {
    done(this, null, null);
  }
}

Transform.prototype.push = function (chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function (chunk, encoding, cb) {
  throw new Error('_transform() is not implemented');
};

Transform.prototype._write = function (chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function (n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};

Transform.prototype._destroy = function (err, cb) {
  var _this2 = this;

  Duplex.prototype._destroy.call(this, err, function (err2) {
    cb(err2);
    _this2.emit('close');
  });
};

function done(stream, er, data) {
  if (er) return stream.emit('error', er);

  if (data != null) // single equals check for both `null` and `undefined`
    stream.push(data);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  if (stream._writableState.length) throw new Error('Calling transform done when ws.length != 0');

  if (stream._transformState.transforming) throw new Error('Calling transform done when still transforming');

  return stream.push(null);
}
},{"./_stream_duplex":33,"core-util-is":11,"inherits":24}],37:[function(require,module,exports){
(function (process,global,setImmediate){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

'use strict';

/*<replacement>*/

var pna = require('process-nextick-args');
/*</replacement>*/

module.exports = Writable;

/* <replacement> */
function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
}

// It seems a linked list but it is not
// there will be only 2 of these for each stream
function CorkedRequest(state) {
  var _this = this;

  this.next = null;
  this.entry = null;
  this.finish = function () {
    onCorkedFinish(_this, state);
  };
}
/* </replacement> */

/*<replacement>*/
var asyncWrite = !process.browser && ['v0.10', 'v0.9.'].indexOf(process.version.slice(0, 5)) > -1 ? setImmediate : pna.nextTick;
/*</replacement>*/

/*<replacement>*/
var Duplex;
/*</replacement>*/

Writable.WritableState = WritableState;

/*<replacement>*/
var util = Object.create(require('core-util-is'));
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var internalUtil = {
  deprecate: require('util-deprecate')
};
/*</replacement>*/

/*<replacement>*/
var Stream = require('./internal/streams/stream');
/*</replacement>*/

/*<replacement>*/

var Buffer = require('safe-buffer').Buffer;
var OurUint8Array = global.Uint8Array || function () {};
function _uint8ArrayToBuffer(chunk) {
  return Buffer.from(chunk);
}
function _isUint8Array(obj) {
  return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
}

/*</replacement>*/

var destroyImpl = require('./internal/streams/destroy');

util.inherits(Writable, Stream);

function nop() {}

function WritableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // Duplex streams are both readable and writable, but share
  // the same options object.
  // However, some cases require setting options to different
  // values for the readable and the writable sides of the duplex stream.
  // These options can be provided separately as readableXXX and writableXXX.
  var isDuplex = stream instanceof Duplex;

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (isDuplex) this.objectMode = this.objectMode || !!options.writableObjectMode;

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var writableHwm = options.writableHighWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;

  if (hwm || hwm === 0) this.highWaterMark = hwm;else if (isDuplex && (writableHwm || writableHwm === 0)) this.highWaterMark = writableHwm;else this.highWaterMark = defaultHwm;

  // cast to ints.
  this.highWaterMark = Math.floor(this.highWaterMark);

  // if _final has been called
  this.finalCalled = false;

  // drain event flag.
  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // has it been destroyed
  this.destroyed = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function (er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.bufferedRequest = null;
  this.lastBufferedRequest = null;

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;

  // count buffered requests
  this.bufferedRequestCount = 0;

  // allocate the first CorkedRequest, there is always
  // one allocated and free to use, and we maintain at most two
  this.corkedRequestsFree = new CorkedRequest(this);
}

WritableState.prototype.getBuffer = function getBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};

(function () {
  try {
    Object.defineProperty(WritableState.prototype, 'buffer', {
      get: internalUtil.deprecate(function () {
        return this.getBuffer();
      }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.', 'DEP0003')
    });
  } catch (_) {}
})();

// Test _writableState for inheritance to account for Duplex streams,
// whose prototype chain only points to Readable.
var realHasInstance;
if (typeof Symbol === 'function' && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === 'function') {
  realHasInstance = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(Writable, Symbol.hasInstance, {
    value: function (object) {
      if (realHasInstance.call(this, object)) return true;
      if (this !== Writable) return false;

      return object && object._writableState instanceof WritableState;
    }
  });
} else {
  realHasInstance = function (object) {
    return object instanceof this;
  };
}

function Writable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, too.
  // `realHasInstance` is necessary because using plain `instanceof`
  // would return false, as no `_writableState` property is attached.

  // Trying to use the custom `instanceof` for Writable here will also break the
  // Node.js LazyTransform implementation, which has a non-trivial getter for
  // `_writableState` that would lead to infinite recursion.
  if (!realHasInstance.call(Writable, this) && !(this instanceof Duplex)) {
    return new Writable(options);
  }

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  if (options) {
    if (typeof options.write === 'function') this._write = options.write;

    if (typeof options.writev === 'function') this._writev = options.writev;

    if (typeof options.destroy === 'function') this._destroy = options.destroy;

    if (typeof options.final === 'function') this._final = options.final;
  }

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function () {
  this.emit('error', new Error('Cannot pipe, not readable'));
};

function writeAfterEnd(stream, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  pna.nextTick(cb, er);
}

// Checks that a user-supplied chunk is valid, especially for the particular
// mode the stream is in. Currently this means that `null` is never accepted
// and undefined/non-string values are only allowed in object mode.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  var er = false;

  if (chunk === null) {
    er = new TypeError('May not write null values to stream');
  } else if (typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  if (er) {
    stream.emit('error', er);
    pna.nextTick(cb, er);
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function (chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;
  var isBuf = !state.objectMode && _isUint8Array(chunk);

  if (isBuf && !Buffer.isBuffer(chunk)) {
    chunk = _uint8ArrayToBuffer(chunk);
  }

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (isBuf) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;

  if (typeof cb !== 'function') cb = nop;

  if (state.ended) writeAfterEnd(this, cb);else if (isBuf || validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function () {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function () {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string') encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new TypeError('Unknown encoding: ' + encoding);
  this._writableState.defaultEncoding = encoding;
  return this;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
    chunk = Buffer.from(chunk, encoding);
  }
  return chunk;
}

Object.defineProperty(Writable.prototype, 'writableHighWaterMark', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function () {
    return this._writableState.highWaterMark;
  }
});

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
  if (!isBuf) {
    var newChunk = decodeChunk(state, chunk, encoding);
    if (chunk !== newChunk) {
      isBuf = true;
      encoding = 'buffer';
      chunk = newChunk;
    }
  }
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret) state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = {
      chunk: chunk,
      encoding: encoding,
      isBuf: isBuf,
      callback: cb,
      next: null
    };
    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }
    state.bufferedRequestCount += 1;
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;

  if (sync) {
    // defer the callback if we are being called synchronously
    // to avoid piling up things on the stack
    pna.nextTick(cb, er);
    // this can emit finish, and it will always happen
    // after error
    pna.nextTick(finishMaybe, stream, state);
    stream._writableState.errorEmitted = true;
    stream.emit('error', er);
  } else {
    // the caller expect this to happen before if
    // it is async
    cb(er);
    stream._writableState.errorEmitted = true;
    stream.emit('error', er);
    // this can emit finish, but finish must
    // always follow error
    finishMaybe(stream, state);
  }
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er) onwriteError(stream, state, sync, er, cb);else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state);

    if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      /*<replacement>*/
      asyncWrite(afterWrite, stream, state, finished, cb);
      /*</replacement>*/
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished) onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}

// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var l = state.bufferedRequestCount;
    var buffer = new Array(l);
    var holder = state.corkedRequestsFree;
    holder.entry = entry;

    var count = 0;
    var allBuffers = true;
    while (entry) {
      buffer[count] = entry;
      if (!entry.isBuf) allBuffers = false;
      entry = entry.next;
      count += 1;
    }
    buffer.allBuffers = allBuffers;

    doWrite(stream, state, true, state.length, buffer, '', holder.finish);

    // doWrite is almost always async, defer these to save a bit of time
    // as the hot path ends with doWrite
    state.pendingcb++;
    state.lastBufferedRequest = null;
    if (holder.next) {
      state.corkedRequestsFree = holder.next;
      holder.next = null;
    } else {
      state.corkedRequestsFree = new CorkedRequest(state);
    }
    state.bufferedRequestCount = 0;
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      state.bufferedRequestCount--;
      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        break;
      }
    }

    if (entry === null) state.lastBufferedRequest = null;
  }

  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable.prototype._write = function (chunk, encoding, cb) {
  cb(new Error('_write() is not implemented'));
};

Writable.prototype._writev = null;

Writable.prototype.end = function (chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished) endWritable(this, state, cb);
};

function needFinish(state) {
  return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
}
function callFinal(stream, state) {
  stream._final(function (err) {
    state.pendingcb--;
    if (err) {
      stream.emit('error', err);
    }
    state.prefinished = true;
    stream.emit('prefinish');
    finishMaybe(stream, state);
  });
}
function prefinish(stream, state) {
  if (!state.prefinished && !state.finalCalled) {
    if (typeof stream._final === 'function') {
      state.pendingcb++;
      state.finalCalled = true;
      pna.nextTick(callFinal, stream, state);
    } else {
      state.prefinished = true;
      stream.emit('prefinish');
    }
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);
  if (need) {
    prefinish(stream, state);
    if (state.pendingcb === 0) {
      state.finished = true;
      stream.emit('finish');
    }
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished) pna.nextTick(cb);else stream.once('finish', cb);
  }
  state.ended = true;
  stream.writable = false;
}

function onCorkedFinish(corkReq, state, err) {
  var entry = corkReq.entry;
  corkReq.entry = null;
  while (entry) {
    var cb = entry.callback;
    state.pendingcb--;
    cb(err);
    entry = entry.next;
  }
  if (state.corkedRequestsFree) {
    state.corkedRequestsFree.next = corkReq;
  } else {
    state.corkedRequestsFree = corkReq;
  }
}

Object.defineProperty(Writable.prototype, 'destroyed', {
  get: function () {
    if (this._writableState === undefined) {
      return false;
    }
    return this._writableState.destroyed;
  },
  set: function (value) {
    // we ignore the value if the stream
    // has not been initialized yet
    if (!this._writableState) {
      return;
    }

    // backward compatibility, the user is explicitly
    // managing destroyed
    this._writableState.destroyed = value;
  }
});

Writable.prototype.destroy = destroyImpl.destroy;
Writable.prototype._undestroy = destroyImpl.undestroy;
Writable.prototype._destroy = function (err, cb) {
  this.end();
  cb(err);
};
}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("timers").setImmediate)
},{"./_stream_duplex":33,"./internal/streams/destroy":39,"./internal/streams/stream":40,"_process":31,"core-util-is":11,"inherits":24,"process-nextick-args":30,"safe-buffer":41,"timers":48,"util-deprecate":49}],38:[function(require,module,exports){
'use strict';

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Buffer = require('safe-buffer').Buffer;
var util = require('util');

function copyBuffer(src, target, offset) {
  src.copy(target, offset);
}

module.exports = function () {
  function BufferList() {
    _classCallCheck(this, BufferList);

    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  BufferList.prototype.push = function push(v) {
    var entry = { data: v, next: null };
    if (this.length > 0) this.tail.next = entry;else this.head = entry;
    this.tail = entry;
    ++this.length;
  };

  BufferList.prototype.unshift = function unshift(v) {
    var entry = { data: v, next: this.head };
    if (this.length === 0) this.tail = entry;
    this.head = entry;
    ++this.length;
  };

  BufferList.prototype.shift = function shift() {
    if (this.length === 0) return;
    var ret = this.head.data;
    if (this.length === 1) this.head = this.tail = null;else this.head = this.head.next;
    --this.length;
    return ret;
  };

  BufferList.prototype.clear = function clear() {
    this.head = this.tail = null;
    this.length = 0;
  };

  BufferList.prototype.join = function join(s) {
    if (this.length === 0) return '';
    var p = this.head;
    var ret = '' + p.data;
    while (p = p.next) {
      ret += s + p.data;
    }return ret;
  };

  BufferList.prototype.concat = function concat(n) {
    if (this.length === 0) return Buffer.alloc(0);
    if (this.length === 1) return this.head.data;
    var ret = Buffer.allocUnsafe(n >>> 0);
    var p = this.head;
    var i = 0;
    while (p) {
      copyBuffer(p.data, ret, i);
      i += p.data.length;
      p = p.next;
    }
    return ret;
  };

  return BufferList;
}();

if (util && util.inspect && util.inspect.custom) {
  module.exports.prototype[util.inspect.custom] = function () {
    var obj = util.inspect({ length: this.length });
    return this.constructor.name + ' ' + obj;
  };
}
},{"safe-buffer":41,"util":8}],39:[function(require,module,exports){
'use strict';

/*<replacement>*/

var pna = require('process-nextick-args');
/*</replacement>*/

// undocumented cb() API, needed for core, not for public API
function destroy(err, cb) {
  var _this = this;

  var readableDestroyed = this._readableState && this._readableState.destroyed;
  var writableDestroyed = this._writableState && this._writableState.destroyed;

  if (readableDestroyed || writableDestroyed) {
    if (cb) {
      cb(err);
    } else if (err && (!this._writableState || !this._writableState.errorEmitted)) {
      pna.nextTick(emitErrorNT, this, err);
    }
    return this;
  }

  // we set destroyed to true before firing error callbacks in order
  // to make it re-entrance safe in case destroy() is called within callbacks

  if (this._readableState) {
    this._readableState.destroyed = true;
  }

  // if this is a duplex stream mark the writable part as destroyed as well
  if (this._writableState) {
    this._writableState.destroyed = true;
  }

  this._destroy(err || null, function (err) {
    if (!cb && err) {
      pna.nextTick(emitErrorNT, _this, err);
      if (_this._writableState) {
        _this._writableState.errorEmitted = true;
      }
    } else if (cb) {
      cb(err);
    }
  });

  return this;
}

function undestroy() {
  if (this._readableState) {
    this._readableState.destroyed = false;
    this._readableState.reading = false;
    this._readableState.ended = false;
    this._readableState.endEmitted = false;
  }

  if (this._writableState) {
    this._writableState.destroyed = false;
    this._writableState.ended = false;
    this._writableState.ending = false;
    this._writableState.finished = false;
    this._writableState.errorEmitted = false;
  }
}

function emitErrorNT(self, err) {
  self.emit('error', err);
}

module.exports = {
  destroy: destroy,
  undestroy: undestroy
};
},{"process-nextick-args":30}],40:[function(require,module,exports){
module.exports = require('events').EventEmitter;

},{"events":54}],41:[function(require,module,exports){
/* eslint-disable node/no-deprecated-api */
var buffer = require('buffer')
var Buffer = buffer.Buffer

// alternative to using Object.keys for old browsers
function copyProps (src, dst) {
  for (var key in src) {
    dst[key] = src[key]
  }
}
if (Buffer.from && Buffer.alloc && Buffer.allocUnsafe && Buffer.allocUnsafeSlow) {
  module.exports = buffer
} else {
  // Copy properties from require('buffer')
  copyProps(buffer, exports)
  exports.Buffer = SafeBuffer
}

function SafeBuffer (arg, encodingOrOffset, length) {
  return Buffer(arg, encodingOrOffset, length)
}

// Copy static methods from Buffer
copyProps(Buffer, SafeBuffer)

SafeBuffer.from = function (arg, encodingOrOffset, length) {
  if (typeof arg === 'number') {
    throw new TypeError('Argument must not be a number')
  }
  return Buffer(arg, encodingOrOffset, length)
}

SafeBuffer.alloc = function (size, fill, encoding) {
  if (typeof size !== 'number') {
    throw new TypeError('Argument must be a number')
  }
  var buf = Buffer(size)
  if (fill !== undefined) {
    if (typeof encoding === 'string') {
      buf.fill(fill, encoding)
    } else {
      buf.fill(fill)
    }
  } else {
    buf.fill(0)
  }
  return buf
}

SafeBuffer.allocUnsafe = function (size) {
  if (typeof size !== 'number') {
    throw new TypeError('Argument must be a number')
  }
  return Buffer(size)
}

SafeBuffer.allocUnsafeSlow = function (size) {
  if (typeof size !== 'number') {
    throw new TypeError('Argument must be a number')
  }
  return buffer.SlowBuffer(size)
}

},{"buffer":53}],42:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

/*<replacement>*/

var Buffer = require('safe-buffer').Buffer;
/*</replacement>*/

var isEncoding = Buffer.isEncoding || function (encoding) {
  encoding = '' + encoding;
  switch (encoding && encoding.toLowerCase()) {
    case 'hex':case 'utf8':case 'utf-8':case 'ascii':case 'binary':case 'base64':case 'ucs2':case 'ucs-2':case 'utf16le':case 'utf-16le':case 'raw':
      return true;
    default:
      return false;
  }
};

function _normalizeEncoding(enc) {
  if (!enc) return 'utf8';
  var retried;
  while (true) {
    switch (enc) {
      case 'utf8':
      case 'utf-8':
        return 'utf8';
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return 'utf16le';
      case 'latin1':
      case 'binary':
        return 'latin1';
      case 'base64':
      case 'ascii':
      case 'hex':
        return enc;
      default:
        if (retried) return; // undefined
        enc = ('' + enc).toLowerCase();
        retried = true;
    }
  }
};

// Do not cache `Buffer.isEncoding` when checking encoding names as some
// modules monkey-patch it to support additional encodings
function normalizeEncoding(enc) {
  var nenc = _normalizeEncoding(enc);
  if (typeof nenc !== 'string' && (Buffer.isEncoding === isEncoding || !isEncoding(enc))) throw new Error('Unknown encoding: ' + enc);
  return nenc || enc;
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters.
exports.StringDecoder = StringDecoder;
function StringDecoder(encoding) {
  this.encoding = normalizeEncoding(encoding);
  var nb;
  switch (this.encoding) {
    case 'utf16le':
      this.text = utf16Text;
      this.end = utf16End;
      nb = 4;
      break;
    case 'utf8':
      this.fillLast = utf8FillLast;
      nb = 4;
      break;
    case 'base64':
      this.text = base64Text;
      this.end = base64End;
      nb = 3;
      break;
    default:
      this.write = simpleWrite;
      this.end = simpleEnd;
      return;
  }
  this.lastNeed = 0;
  this.lastTotal = 0;
  this.lastChar = Buffer.allocUnsafe(nb);
}

StringDecoder.prototype.write = function (buf) {
  if (buf.length === 0) return '';
  var r;
  var i;
  if (this.lastNeed) {
    r = this.fillLast(buf);
    if (r === undefined) return '';
    i = this.lastNeed;
    this.lastNeed = 0;
  } else {
    i = 0;
  }
  if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
  return r || '';
};

StringDecoder.prototype.end = utf8End;

// Returns only complete characters in a Buffer
StringDecoder.prototype.text = utf8Text;

// Attempts to complete a partial non-UTF-8 character using bytes from a Buffer
StringDecoder.prototype.fillLast = function (buf) {
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
  this.lastNeed -= buf.length;
};

// Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
// continuation byte. If an invalid byte is detected, -2 is returned.
function utf8CheckByte(byte) {
  if (byte <= 0x7F) return 0;else if (byte >> 5 === 0x06) return 2;else if (byte >> 4 === 0x0E) return 3;else if (byte >> 3 === 0x1E) return 4;
  return byte >> 6 === 0x02 ? -1 : -2;
}

// Checks at most 3 bytes at the end of a Buffer in order to detect an
// incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
// needed to complete the UTF-8 character (if applicable) are returned.
function utf8CheckIncomplete(self, buf, i) {
  var j = buf.length - 1;
  if (j < i) return 0;
  var nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) self.lastNeed = nb - 1;
    return nb;
  }
  if (--j < i || nb === -2) return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) self.lastNeed = nb - 2;
    return nb;
  }
  if (--j < i || nb === -2) return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) {
      if (nb === 2) nb = 0;else self.lastNeed = nb - 3;
    }
    return nb;
  }
  return 0;
}

// Validates as many continuation bytes for a multi-byte UTF-8 character as
// needed or are available. If we see a non-continuation byte where we expect
// one, we "replace" the validated continuation bytes we've seen so far with
// a single UTF-8 replacement character ('\ufffd'), to match v8's UTF-8 decoding
// behavior. The continuation byte check is included three times in the case
// where all of the continuation bytes for a character exist in the same buffer.
// It is also done this way as a slight performance increase instead of using a
// loop.
function utf8CheckExtraBytes(self, buf, p) {
  if ((buf[0] & 0xC0) !== 0x80) {
    self.lastNeed = 0;
    return '\ufffd';
  }
  if (self.lastNeed > 1 && buf.length > 1) {
    if ((buf[1] & 0xC0) !== 0x80) {
      self.lastNeed = 1;
      return '\ufffd';
    }
    if (self.lastNeed > 2 && buf.length > 2) {
      if ((buf[2] & 0xC0) !== 0x80) {
        self.lastNeed = 2;
        return '\ufffd';
      }
    }
  }
}

// Attempts to complete a multi-byte UTF-8 character using bytes from a Buffer.
function utf8FillLast(buf) {
  var p = this.lastTotal - this.lastNeed;
  var r = utf8CheckExtraBytes(this, buf, p);
  if (r !== undefined) return r;
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, p, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, p, 0, buf.length);
  this.lastNeed -= buf.length;
}

// Returns all complete UTF-8 characters in a Buffer. If the Buffer ended on a
// partial character, the character's bytes are buffered until the required
// number of bytes are available.
function utf8Text(buf, i) {
  var total = utf8CheckIncomplete(this, buf, i);
  if (!this.lastNeed) return buf.toString('utf8', i);
  this.lastTotal = total;
  var end = buf.length - (total - this.lastNeed);
  buf.copy(this.lastChar, 0, end);
  return buf.toString('utf8', i, end);
}

// For UTF-8, a replacement character is added when ending on a partial
// character.
function utf8End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) return r + '\ufffd';
  return r;
}

// UTF-16LE typically needs two bytes per character, but even if we have an even
// number of bytes available, we need to check if we end on a leading/high
// surrogate. In that case, we need to wait for the next two bytes in order to
// decode the last character properly.
function utf16Text(buf, i) {
  if ((buf.length - i) % 2 === 0) {
    var r = buf.toString('utf16le', i);
    if (r) {
      var c = r.charCodeAt(r.length - 1);
      if (c >= 0xD800 && c <= 0xDBFF) {
        this.lastNeed = 2;
        this.lastTotal = 4;
        this.lastChar[0] = buf[buf.length - 2];
        this.lastChar[1] = buf[buf.length - 1];
        return r.slice(0, -1);
      }
    }
    return r;
  }
  this.lastNeed = 1;
  this.lastTotal = 2;
  this.lastChar[0] = buf[buf.length - 1];
  return buf.toString('utf16le', i, buf.length - 1);
}

// For UTF-16LE we do not explicitly append special replacement characters if we
// end on a partial character, we simply let v8 handle that.
function utf16End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) {
    var end = this.lastTotal - this.lastNeed;
    return r + this.lastChar.toString('utf16le', 0, end);
  }
  return r;
}

function base64Text(buf, i) {
  var n = (buf.length - i) % 3;
  if (n === 0) return buf.toString('base64', i);
  this.lastNeed = 3 - n;
  this.lastTotal = 3;
  if (n === 1) {
    this.lastChar[0] = buf[buf.length - 1];
  } else {
    this.lastChar[0] = buf[buf.length - 2];
    this.lastChar[1] = buf[buf.length - 1];
  }
  return buf.toString('base64', i, buf.length - n);
}

function base64End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) return r + this.lastChar.toString('base64', 0, 3 - this.lastNeed);
  return r;
}

// Pass bytes on through for single-byte encodings (e.g. ascii, latin1, hex)
function simpleWrite(buf) {
  return buf.toString(this.encoding);
}

function simpleEnd(buf) {
  return buf && buf.length ? this.write(buf) : '';
}
},{"safe-buffer":41}],43:[function(require,module,exports){
module.exports = require('./readable').PassThrough

},{"./readable":44}],44:[function(require,module,exports){
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = exports;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":33,"./lib/_stream_passthrough.js":34,"./lib/_stream_readable.js":35,"./lib/_stream_transform.js":36,"./lib/_stream_writable.js":37}],45:[function(require,module,exports){
module.exports = require('./readable').Transform

},{"./readable":44}],46:[function(require,module,exports){
module.exports = require('./lib/_stream_writable.js');

},{"./lib/_stream_writable.js":37}],47:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":54,"inherits":24,"readable-stream/duplex.js":32,"readable-stream/passthrough.js":43,"readable-stream/readable.js":44,"readable-stream/transform.js":45,"readable-stream/writable.js":46}],48:[function(require,module,exports){
(function (setImmediate,clearImmediate){
var nextTick = require('process/browser.js').nextTick;
var apply = Function.prototype.apply;
var slice = Array.prototype.slice;
var immediateIds = {};
var nextImmediateId = 0;

// DOM APIs, for completeness

exports.setTimeout = function() {
  return new Timeout(apply.call(setTimeout, window, arguments), clearTimeout);
};
exports.setInterval = function() {
  return new Timeout(apply.call(setInterval, window, arguments), clearInterval);
};
exports.clearTimeout =
exports.clearInterval = function(timeout) { timeout.close(); };

function Timeout(id, clearFn) {
  this._id = id;
  this._clearFn = clearFn;
}
Timeout.prototype.unref = Timeout.prototype.ref = function() {};
Timeout.prototype.close = function() {
  this._clearFn.call(window, this._id);
};

// Does not start the time, just sets up the members needed.
exports.enroll = function(item, msecs) {
  clearTimeout(item._idleTimeoutId);
  item._idleTimeout = msecs;
};

exports.unenroll = function(item) {
  clearTimeout(item._idleTimeoutId);
  item._idleTimeout = -1;
};

exports._unrefActive = exports.active = function(item) {
  clearTimeout(item._idleTimeoutId);

  var msecs = item._idleTimeout;
  if (msecs >= 0) {
    item._idleTimeoutId = setTimeout(function onTimeout() {
      if (item._onTimeout)
        item._onTimeout();
    }, msecs);
  }
};

// That's not how node.js implements it but the exposed api is the same.
exports.setImmediate = typeof setImmediate === "function" ? setImmediate : function(fn) {
  var id = nextImmediateId++;
  var args = arguments.length < 2 ? false : slice.call(arguments, 1);

  immediateIds[id] = true;

  nextTick(function onNextTick() {
    if (immediateIds[id]) {
      // fn.call() is faster so we optimize for the common use-case
      // @see http://jsperf.com/call-apply-segu
      if (args) {
        fn.apply(null, args);
      } else {
        fn.call(null);
      }
      // Prevent ids from leaking
      exports.clearImmediate(id);
    }
  });

  return id;
};

exports.clearImmediate = typeof clearImmediate === "function" ? clearImmediate : function(id) {
  delete immediateIds[id];
};
}).call(this,require("timers").setImmediate,require("timers").clearImmediate)
},{"process/browser.js":31,"timers":48}],49:[function(require,module,exports){
(function (global){

/**
 * Module exports.
 */

module.exports = deprecate;

/**
 * Mark that a method should not be used.
 * Returns a modified function which warns once by default.
 *
 * If `localStorage.noDeprecation = true` is set, then it is a no-op.
 *
 * If `localStorage.throwDeprecation = true` is set, then deprecated functions
 * will throw an Error when invoked.
 *
 * If `localStorage.traceDeprecation = true` is set, then deprecated functions
 * will invoke `console.trace()` instead of `console.error()`.
 *
 * @param {Function} fn - the function to deprecate
 * @param {String} msg - the string to print to the console when `fn` is invoked
 * @returns {Function} a new "deprecated" version of `fn`
 * @api public
 */

function deprecate (fn, msg) {
  if (config('noDeprecation')) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config('throwDeprecation')) {
        throw new Error(msg);
      } else if (config('traceDeprecation')) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}

/**
 * Checks `localStorage` for boolean values for the given `name`.
 *
 * @param {String} name
 * @returns {Boolean}
 * @api private
 */

function config (name) {
  // accessing global.localStorage can trigger a DOMException in sandboxed iframes
  try {
    if (!global.localStorage) return false;
  } catch (_) {
    return false;
  }
  var val = global.localStorage[name];
  if (null == val) return false;
  return String(val).toLowerCase() === 'true';
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],50:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],51:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],52:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":51,"_process":31,"inherits":50}],53:[function(require,module,exports){
(function (Buffer){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function () { return 42 } }
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species != null &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value)
  }

  if (value == null) {
    throw TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }

  if (isInstance(value, ArrayBuffer) ||
      (value && isInstance(value.buffer, ArrayBuffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'number') {
    throw new TypeError(
      'The "value" argument must not be of type number. Received type number'
    )
  }

  var valueOf = value.valueOf && value.valueOf()
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length)
  }

  var b = fromObject(value)
  if (b) return b

  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
      typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(
      value[Symbol.toPrimitive]('string'), encodingOrOffset, length
    )
  }

  throw new TypeError(
    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
    'or Array-like Object. Received type ' + (typeof value)
  )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0)
    }
    return fromArrayLike(obj)
  }

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data)
  }
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true &&
    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    )
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
      'Received type ' + typeof string
    )
  }

  var len = string.length
  var mustMatch = (arguments.length > 2 && arguments[2] === true)
  if (!mustMatch && len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
        }
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
  if (this.length > max) str += ' ... '
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength)
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError(
      'The "target" argument must be one of type Buffer or Uint8Array. ' +
      'Received type ' + (typeof target)
    )
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
        : (firstByte > 0xBF) ? 2
          : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
function isInstance (obj, type) {
  return obj instanceof type ||
    (obj != null && obj.constructor != null && obj.constructor.name != null &&
      obj.constructor.name === type.name)
}
function numberIsNaN (obj) {
  // For IE11 support
  return obj !== obj // eslint-disable-line no-self-compare
}

}).call(this,require("buffer").Buffer)
},{"base64-js":7,"buffer":53,"ieee754":23}],54:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}]},{},[4]);
