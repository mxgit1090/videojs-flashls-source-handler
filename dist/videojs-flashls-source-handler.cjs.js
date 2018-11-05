/*! @name @brightcove/videojs-flashls-source-handler @version 1.4.5 @license Apache-2.0 */
'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var videojs = _interopDefault(require('video.js'));
var window = _interopDefault(require('global/window'));

/**
 * mux.js
 *
 * Copyright (c) 2014 Brightcove
 * All rights reserved.
 *
 * A lightweight readable stream implemention that handles event dispatching.
 * Objects that inherit from streams should call init in their constructors.
 */

var Stream = function() {
  this.init = function() {
    var listeners = {};
    /**
     * Add a listener for a specified event type.
     * @param type {string} the event name
     * @param listener {function} the callback to be invoked when an event of
     * the specified type occurs
     */
    this.on = function(type, listener) {
      if (!listeners[type]) {
        listeners[type] = [];
      }
      listeners[type] = listeners[type].concat(listener);
    };
    /**
     * Remove a listener for a specified event type.
     * @param type {string} the event name
     * @param listener {function} a function previously registered for this
     * type of event through `on`
     */
    this.off = function(type, listener) {
      var index;
      if (!listeners[type]) {
        return false;
      }
      index = listeners[type].indexOf(listener);
      listeners[type] = listeners[type].slice();
      listeners[type].splice(index, 1);
      return index > -1;
    };
    /**
     * Trigger an event of the specified type on this stream. Any additional
     * arguments to this function are passed as parameters to event listeners.
     * @param type {string} the event name
     */
    this.trigger = function(type) {
      var callbacks, i, length, args;
      callbacks = listeners[type];
      if (!callbacks) {
        return;
      }
      // Slicing the arguments on every invocation of this method
      // can add a significant amount of overhead. Avoid the
      // intermediate object creation for the common case of a
      // single callback argument
      if (arguments.length === 2) {
        length = callbacks.length;
        for (i = 0; i < length; ++i) {
          callbacks[i].call(this, arguments[1]);
        }
      } else {
        args = [];
        i = arguments.length;
        for (i = 1; i < arguments.length; ++i) {
          args.push(arguments[i]);
        }
        length = callbacks.length;
        for (i = 0; i < length; ++i) {
          callbacks[i].apply(this, args);
        }
      }
    };
    /**
     * Destroys the stream and cleans up.
     */
    this.dispose = function() {
      listeners = {};
    };
  };
};

/**
 * Forwards all `data` events on this stream to the destination stream. The
 * destination stream should provide a method `push` to receive the data
 * events as they arrive.
 * @param destination {stream} the stream that will receive all `data` events
 * @param autoFlush {boolean} if false, we will not call `flush` on the destination
 *                            when the current stream emits a 'done' event
 * @see http://nodejs.org/api/stream.html#stream_readable_pipe_destination_options
 */
Stream.prototype.pipe = function(destination) {
  this.on('data', function(data) {
    destination.push(data);
  });

  this.on('done', function(flushSource) {
    destination.flush(flushSource);
  });

  return destination;
};

// Default stream functions that are expected to be overridden to perform
// actual work. These are provided by the prototype as a sort of no-op
// implementation so that we don't have to check for their existence in the
// `pipe` function above.
Stream.prototype.push = function(data) {
  this.trigger('data', data);
};

Stream.prototype.flush = function(flushSource) {
  this.trigger('done', flushSource);
};

var stream = Stream;

/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Reads in-band caption information from a video elementary
 * stream. Captions must follow the CEA-708 standard for injection
 * into an MPEG-2 transport streams.
 * @see https://en.wikipedia.org/wiki/CEA-708
 * @see https://www.gpo.gov/fdsys/pkg/CFR-2007-title47-vol1/pdf/CFR-2007-title47-vol1-sec15-119.pdf
 */

// Supplemental enhancement information (SEI) NAL units have a
// payload type field to indicate how they are to be
// interpreted. CEAS-708 caption content is always transmitted with
// payload type 0x04.
var USER_DATA_REGISTERED_ITU_T_T35 = 4,
    RBSP_TRAILING_BITS = 128;

/**
  * Parse a supplemental enhancement information (SEI) NAL unit.
  * Stops parsing once a message of type ITU T T35 has been found.
  *
  * @param bytes {Uint8Array} the bytes of a SEI NAL unit
  * @return {object} the parsed SEI payload
  * @see Rec. ITU-T H.264, 7.3.2.3.1
  */
var parseSei = function(bytes) {
  var
    i = 0,
    result = {
      payloadType: -1,
      payloadSize: 0
    },
    payloadType = 0,
    payloadSize = 0;

  // go through the sei_rbsp parsing each each individual sei_message
  while (i < bytes.byteLength) {
    // stop once we have hit the end of the sei_rbsp
    if (bytes[i] === RBSP_TRAILING_BITS) {
      break;
    }

    // Parse payload type
    while (bytes[i] === 0xFF) {
      payloadType += 255;
      i++;
    }
    payloadType += bytes[i++];

    // Parse payload size
    while (bytes[i] === 0xFF) {
      payloadSize += 255;
      i++;
    }
    payloadSize += bytes[i++];

    // this sei_message is a 608/708 caption so save it and break
    // there can only ever be one caption message in a frame's sei
    if (!result.payload && payloadType === USER_DATA_REGISTERED_ITU_T_T35) {
      result.payloadType = payloadType;
      result.payloadSize = payloadSize;
      result.payload = bytes.subarray(i, i + payloadSize);
      break;
    }

    // skip the payload and parse the next message
    i += payloadSize;
    payloadType = 0;
    payloadSize = 0;
  }

  return result;
};

// see ANSI/SCTE 128-1 (2013), section 8.1
var parseUserData = function(sei) {
  // itu_t_t35_contry_code must be 181 (United States) for
  // captions
  if (sei.payload[0] !== 181) {
    return null;
  }

  // itu_t_t35_provider_code should be 49 (ATSC) for captions
  if (((sei.payload[1] << 8) | sei.payload[2]) !== 49) {
    return null;
  }

  // the user_identifier should be "GA94" to indicate ATSC1 data
  if (String.fromCharCode(sei.payload[3],
                          sei.payload[4],
                          sei.payload[5],
                          sei.payload[6]) !== 'GA94') {
    return null;
  }

  // finally, user_data_type_code should be 0x03 for caption data
  if (sei.payload[7] !== 0x03) {
    return null;
  }

  // return the user_data_type_structure and strip the trailing
  // marker bits
  return sei.payload.subarray(8, sei.payload.length - 1);
};

// see CEA-708-D, section 4.4
var parseCaptionPackets = function(pts, userData) {
  var results = [], i, count, offset, data;

  // if this is just filler, return immediately
  if (!(userData[0] & 0x40)) {
    return results;
  }

  // parse out the cc_data_1 and cc_data_2 fields
  count = userData[0] & 0x1f;
  for (i = 0; i < count; i++) {
    offset = i * 3;
    data = {
      type: userData[offset + 2] & 0x03,
      pts: pts
    };

    // capture cc data when cc_valid is 1
    if (userData[offset + 2] & 0x04) {
      data.ccData = (userData[offset + 3] << 8) | userData[offset + 4];
      results.push(data);
    }
  }
  return results;
};

var discardEmulationPreventionBytes = function(data) {
    var
      length = data.byteLength,
      emulationPreventionBytesPositions = [],
      i = 1,
      newLength, newData;

    // Find all `Emulation Prevention Bytes`
    while (i < length - 2) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0x03) {
        emulationPreventionBytesPositions.push(i + 2);
        i += 2;
      } else {
        i++;
      }
    }

    // If no Emulation Prevention Bytes were found just return the original
    // array
    if (emulationPreventionBytesPositions.length === 0) {
      return data;
    }

    // Create a new array to hold the NAL unit data
    newLength = length - emulationPreventionBytesPositions.length;
    newData = new Uint8Array(newLength);
    var sourceIndex = 0;

    for (i = 0; i < newLength; sourceIndex++, i++) {
      if (sourceIndex === emulationPreventionBytesPositions[0]) {
        // Skip this byte
        sourceIndex++;
        // Remove this position index
        emulationPreventionBytesPositions.shift();
      }
      newData[i] = data[sourceIndex];
    }

    return newData;
};

// exports
var captionPacketParser = {
  parseSei: parseSei,
  parseUserData: parseUserData,
  parseCaptionPackets: parseCaptionPackets,
  discardEmulationPreventionBytes: discardEmulationPreventionBytes,
  USER_DATA_REGISTERED_ITU_T_T35: USER_DATA_REGISTERED_ITU_T_T35
};

// -----------------
// Link To Transport
// -----------------




var CaptionStream = function() {

  CaptionStream.prototype.init.call(this);

  this.captionPackets_ = [];

  this.ccStreams_ = [
    new Cea608Stream(0, 0), // eslint-disable-line no-use-before-define
    new Cea608Stream(0, 1), // eslint-disable-line no-use-before-define
    new Cea608Stream(1, 0), // eslint-disable-line no-use-before-define
    new Cea608Stream(1, 1) // eslint-disable-line no-use-before-define
  ];

  this.reset();

  // forward data and done events from CCs to this CaptionStream
  this.ccStreams_.forEach(function(cc) {
    cc.on('data', this.trigger.bind(this, 'data'));
    cc.on('done', this.trigger.bind(this, 'done'));
  }, this);

};

CaptionStream.prototype = new stream();
CaptionStream.prototype.push = function(event) {
  var sei, userData, newCaptionPackets;

  // only examine SEI NALs
  if (event.nalUnitType !== 'sei_rbsp') {
    return;
  }

  // parse the sei
  sei = captionPacketParser.parseSei(event.escapedRBSP);

  // ignore everything but user_data_registered_itu_t_t35
  if (sei.payloadType !== captionPacketParser.USER_DATA_REGISTERED_ITU_T_T35) {
    return;
  }

  // parse out the user data payload
  userData = captionPacketParser.parseUserData(sei);

  // ignore unrecognized userData
  if (!userData) {
    return;
  }

  // Sometimes, the same segment # will be downloaded twice. To stop the
  // caption data from being processed twice, we track the latest dts we've
  // received and ignore everything with a dts before that. However, since
  // data for a specific dts can be split across packets on either side of
  // a segment boundary, we need to make sure we *don't* ignore the packets
  // from the *next* segment that have dts === this.latestDts_. By constantly
  // tracking the number of packets received with dts === this.latestDts_, we
  // know how many should be ignored once we start receiving duplicates.
  if (event.dts < this.latestDts_) {
    // We've started getting older data, so set the flag.
    this.ignoreNextEqualDts_ = true;
    return;
  } else if ((event.dts === this.latestDts_) && (this.ignoreNextEqualDts_)) {
    this.numSameDts_--;
    if (!this.numSameDts_) {
      // We've received the last duplicate packet, time to start processing again
      this.ignoreNextEqualDts_ = false;
    }
    return;
  }

  // parse out CC data packets and save them for later
  newCaptionPackets = captionPacketParser.parseCaptionPackets(event.pts, userData);
  this.captionPackets_ = this.captionPackets_.concat(newCaptionPackets);
  if (this.latestDts_ !== event.dts) {
    this.numSameDts_ = 0;
  }
  this.numSameDts_++;
  this.latestDts_ = event.dts;
};

CaptionStream.prototype.flush = function() {
  // make sure we actually parsed captions before proceeding
  if (!this.captionPackets_.length) {
    this.ccStreams_.forEach(function(cc) {
      cc.flush();
    }, this);
    return;
  }

  // In Chrome, the Array#sort function is not stable so add a
  // presortIndex that we can use to ensure we get a stable-sort
  this.captionPackets_.forEach(function(elem, idx) {
    elem.presortIndex = idx;
  });

  // sort caption byte-pairs based on their PTS values
  this.captionPackets_.sort(function(a, b) {
    if (a.pts === b.pts) {
      return a.presortIndex - b.presortIndex;
    }
    return a.pts - b.pts;
  });

  this.captionPackets_.forEach(function(packet) {
    if (packet.type < 2) {
      // Dispatch packet to the right Cea608Stream
      this.dispatchCea608Packet(packet);
    }
    // this is where an 'else' would go for a dispatching packets
    // to a theoretical Cea708Stream that handles SERVICEn data
  }, this);

  this.captionPackets_.length = 0;
  this.ccStreams_.forEach(function(cc) {
    cc.flush();
  }, this);
  return;
};

CaptionStream.prototype.reset = function() {
  this.latestDts_ = null;
  this.ignoreNextEqualDts_ = false;
  this.numSameDts_ = 0;
  this.activeCea608Channel_ = [null, null];
  this.ccStreams_.forEach(function(ccStream) {
    ccStream.reset();
  });
};

CaptionStream.prototype.dispatchCea608Packet = function(packet) {
  // NOTE: packet.type is the CEA608 field
  if (this.setsChannel1Active(packet)) {
    this.activeCea608Channel_[packet.type] = 0;
  } else if (this.setsChannel2Active(packet)) {
    this.activeCea608Channel_[packet.type] = 1;
  }
  if (this.activeCea608Channel_[packet.type] === null) {
    // If we haven't received anything to set the active channel, discard the
    // data; we don't want jumbled captions
    return;
  }
  this.ccStreams_[(packet.type << 1) + this.activeCea608Channel_[packet.type]].push(packet);
};

CaptionStream.prototype.setsChannel1Active = function(packet) {
  return ((packet.ccData & 0x7800) === 0x1000);
};
CaptionStream.prototype.setsChannel2Active = function(packet) {
  return ((packet.ccData & 0x7800) === 0x1800);
};

// ----------------------
// Session to Application
// ----------------------

// This hash maps non-ASCII, special, and extended character codes to their
// proper Unicode equivalent. The first keys that are only a single byte
// are the non-standard ASCII characters, which simply map the CEA608 byte
// to the standard ASCII/Unicode. The two-byte keys that follow are the CEA608
// character codes, but have their MSB bitmasked with 0x03 so that a lookup
// can be performed regardless of the field and data channel on which the
// character code was received.
var CHARACTER_TRANSLATION = {
  0x2a: 0xe1,     // á
  0x5c: 0xe9,     // é
  0x5e: 0xed,     // í
  0x5f: 0xf3,     // ó
  0x60: 0xfa,     // ú
  0x7b: 0xe7,     // ç
  0x7c: 0xf7,     // ÷
  0x7d: 0xd1,     // Ñ
  0x7e: 0xf1,     // ñ
  0x7f: 0x2588,   // █
  0x0130: 0xae,   // ®
  0x0131: 0xb0,   // °
  0x0132: 0xbd,   // ½
  0x0133: 0xbf,   // ¿
  0x0134: 0x2122, // ™
  0x0135: 0xa2,   // ¢
  0x0136: 0xa3,   // £
  0x0137: 0x266a, // ♪
  0x0138: 0xe0,   // à
  0x0139: 0xa0,   //
  0x013a: 0xe8,   // è
  0x013b: 0xe2,   // â
  0x013c: 0xea,   // ê
  0x013d: 0xee,   // î
  0x013e: 0xf4,   // ô
  0x013f: 0xfb,   // û
  0x0220: 0xc1,   // Á
  0x0221: 0xc9,   // É
  0x0222: 0xd3,   // Ó
  0x0223: 0xda,   // Ú
  0x0224: 0xdc,   // Ü
  0x0225: 0xfc,   // ü
  0x0226: 0x2018, // ‘
  0x0227: 0xa1,   // ¡
  0x0228: 0x2a,   // *
  0x0229: 0x27,   // '
  0x022a: 0x2014, // —
  0x022b: 0xa9,   // ©
  0x022c: 0x2120, // ℠
  0x022d: 0x2022, // •
  0x022e: 0x201c, // “
  0x022f: 0x201d, // ”
  0x0230: 0xc0,   // À
  0x0231: 0xc2,   // Â
  0x0232: 0xc7,   // Ç
  0x0233: 0xc8,   // È
  0x0234: 0xca,   // Ê
  0x0235: 0xcb,   // Ë
  0x0236: 0xeb,   // ë
  0x0237: 0xce,   // Î
  0x0238: 0xcf,   // Ï
  0x0239: 0xef,   // ï
  0x023a: 0xd4,   // Ô
  0x023b: 0xd9,   // Ù
  0x023c: 0xf9,   // ù
  0x023d: 0xdb,   // Û
  0x023e: 0xab,   // «
  0x023f: 0xbb,   // »
  0x0320: 0xc3,   // Ã
  0x0321: 0xe3,   // ã
  0x0322: 0xcd,   // Í
  0x0323: 0xcc,   // Ì
  0x0324: 0xec,   // ì
  0x0325: 0xd2,   // Ò
  0x0326: 0xf2,   // ò
  0x0327: 0xd5,   // Õ
  0x0328: 0xf5,   // õ
  0x0329: 0x7b,   // {
  0x032a: 0x7d,   // }
  0x032b: 0x5c,   // \
  0x032c: 0x5e,   // ^
  0x032d: 0x5f,   // _
  0x032e: 0x7c,   // |
  0x032f: 0x7e,   // ~
  0x0330: 0xc4,   // Ä
  0x0331: 0xe4,   // ä
  0x0332: 0xd6,   // Ö
  0x0333: 0xf6,   // ö
  0x0334: 0xdf,   // ß
  0x0335: 0xa5,   // ¥
  0x0336: 0xa4,   // ¤
  0x0337: 0x2502, // │
  0x0338: 0xc5,   // Å
  0x0339: 0xe5,   // å
  0x033a: 0xd8,   // Ø
  0x033b: 0xf8,   // ø
  0x033c: 0x250c, // ┌
  0x033d: 0x2510, // ┐
  0x033e: 0x2514, // └
  0x033f: 0x2518  // ┘
};

var getCharFromCode = function(code) {
  if (code === null) {
    return '';
  }
  code = CHARACTER_TRANSLATION[code] || code;
  return String.fromCharCode(code);
};

// the index of the last row in a CEA-608 display buffer
var BOTTOM_ROW = 14;

// This array is used for mapping PACs -> row #, since there's no way of
// getting it through bit logic.
var ROWS = [0x1100, 0x1120, 0x1200, 0x1220, 0x1500, 0x1520, 0x1600, 0x1620,
            0x1700, 0x1720, 0x1000, 0x1300, 0x1320, 0x1400, 0x1420];

// CEA-608 captions are rendered onto a 34x15 matrix of character
// cells. The "bottom" row is the last element in the outer array.
var createDisplayBuffer = function() {
  var result = [], i = BOTTOM_ROW + 1;
  while (i--) {
    result.push('');
  }
  return result;
};

var Cea608Stream = function(field, dataChannel) {
  Cea608Stream.prototype.init.call(this);

  this.field_ = field || 0;
  this.dataChannel_ = dataChannel || 0;

  this.name_ = 'CC' + (((this.field_ << 1) | this.dataChannel_) + 1);

  this.setConstants();
  this.reset();

  this.push = function(packet) {
    var data, swap, char0, char1, text;
    // remove the parity bits
    data = packet.ccData & 0x7f7f;

    // ignore duplicate control codes; the spec demands they're sent twice
    if (data === this.lastControlCode_) {
      this.lastControlCode_ = null;
      return;
    }

    // Store control codes
    if ((data & 0xf000) === 0x1000) {
      this.lastControlCode_ = data;
    } else if (data !== this.PADDING_) {
      this.lastControlCode_ = null;
    }

    char0 = data >>> 8;
    char1 = data & 0xff;

    if (data === this.PADDING_) {
      return;

    } else if (data === this.RESUME_CAPTION_LOADING_) {
      this.mode_ = 'popOn';

    } else if (data === this.END_OF_CAPTION_) {
      // If an EOC is received while in paint-on mode, the displayed caption
      // text should be swapped to non-displayed memory as if it was a pop-on
      // caption. Because of that, we should explicitly switch back to pop-on
      // mode
      this.mode_ = 'popOn';
      this.clearFormatting(packet.pts);
      // if a caption was being displayed, it's gone now
      this.flushDisplayed(packet.pts);

      // flip memory
      swap = this.displayed_;
      this.displayed_ = this.nonDisplayed_;
      this.nonDisplayed_ = swap;

      // start measuring the time to display the caption
      this.startPts_ = packet.pts;

    } else if (data === this.ROLL_UP_2_ROWS_) {
      this.rollUpRows_ = 2;
      this.setRollUp(packet.pts);
    } else if (data === this.ROLL_UP_3_ROWS_) {
      this.rollUpRows_ = 3;
      this.setRollUp(packet.pts);
    } else if (data === this.ROLL_UP_4_ROWS_) {
      this.rollUpRows_ = 4;
      this.setRollUp(packet.pts);
    } else if (data === this.CARRIAGE_RETURN_) {
      this.clearFormatting(packet.pts);
      this.flushDisplayed(packet.pts);
      this.shiftRowsUp_();
      this.startPts_ = packet.pts;

    } else if (data === this.BACKSPACE_) {
      if (this.mode_ === 'popOn') {
        this.nonDisplayed_[this.row_] = this.nonDisplayed_[this.row_].slice(0, -1);
      } else {
        this.displayed_[this.row_] = this.displayed_[this.row_].slice(0, -1);
      }
    } else if (data === this.ERASE_DISPLAYED_MEMORY_) {
      this.flushDisplayed(packet.pts);
      this.displayed_ = createDisplayBuffer();
    } else if (data === this.ERASE_NON_DISPLAYED_MEMORY_) {
      this.nonDisplayed_ = createDisplayBuffer();

    } else if (data === this.RESUME_DIRECT_CAPTIONING_) {
      if (this.mode_ !== 'paintOn') {
        // NOTE: This should be removed when proper caption positioning is
        // implemented
        this.flushDisplayed(packet.pts);
        this.displayed_ = createDisplayBuffer();
      }
      this.mode_ = 'paintOn';
      this.startPts_ = packet.pts;

    // Append special characters to caption text
    } else if (this.isSpecialCharacter(char0, char1)) {
      // Bitmask char0 so that we can apply character transformations
      // regardless of field and data channel.
      // Then byte-shift to the left and OR with char1 so we can pass the
      // entire character code to `getCharFromCode`.
      char0 = (char0 & 0x03) << 8;
      text = getCharFromCode(char0 | char1);
      this[this.mode_](packet.pts, text);
      this.column_++;

    // Append extended characters to caption text
    } else if (this.isExtCharacter(char0, char1)) {
      // Extended characters always follow their "non-extended" equivalents.
      // IE if a "è" is desired, you'll always receive "eè"; non-compliant
      // decoders are supposed to drop the "è", while compliant decoders
      // backspace the "e" and insert "è".

      // Delete the previous character
      if (this.mode_ === 'popOn') {
        this.nonDisplayed_[this.row_] = this.nonDisplayed_[this.row_].slice(0, -1);
      } else {
        this.displayed_[this.row_] = this.displayed_[this.row_].slice(0, -1);
      }

      // Bitmask char0 so that we can apply character transformations
      // regardless of field and data channel.
      // Then byte-shift to the left and OR with char1 so we can pass the
      // entire character code to `getCharFromCode`.
      char0 = (char0 & 0x03) << 8;
      text = getCharFromCode(char0 | char1);
      this[this.mode_](packet.pts, text);
      this.column_++;

    // Process mid-row codes
    } else if (this.isMidRowCode(char0, char1)) {
      // Attributes are not additive, so clear all formatting
      this.clearFormatting(packet.pts);

      // According to the standard, mid-row codes
      // should be replaced with spaces, so add one now
      this[this.mode_](packet.pts, ' ');
      this.column_++;

      if ((char1 & 0xe) === 0xe) {
        this.addFormatting(packet.pts, ['i']);
      }

      if ((char1 & 0x1) === 0x1) {
        this.addFormatting(packet.pts, ['u']);
      }

    // Detect offset control codes and adjust cursor
    } else if (this.isOffsetControlCode(char0, char1)) {
      // Cursor position is set by indent PAC (see below) in 4-column
      // increments, with an additional offset code of 1-3 to reach any
      // of the 32 columns specified by CEA-608. So all we need to do
      // here is increment the column cursor by the given offset.
      this.column_ += (char1 & 0x03);

    // Detect PACs (Preamble Address Codes)
    } else if (this.isPAC(char0, char1)) {

      // There's no logic for PAC -> row mapping, so we have to just
      // find the row code in an array and use its index :(
      var row = ROWS.indexOf(data & 0x1f20);

      // Configure the caption window if we're in roll-up mode
      if (this.mode_ === 'rollUp') {
        this.setRollUp(packet.pts, row);
      }

      if (row !== this.row_) {
        // formatting is only persistent for current row
        this.clearFormatting(packet.pts);
        this.row_ = row;
      }
      // All PACs can apply underline, so detect and apply
      // (All odd-numbered second bytes set underline)
      if ((char1 & 0x1) && (this.formatting_.indexOf('u') === -1)) {
          this.addFormatting(packet.pts, ['u']);
      }

      if ((data & 0x10) === 0x10) {
        // We've got an indent level code. Each successive even number
        // increments the column cursor by 4, so we can get the desired
        // column position by bit-shifting to the right (to get n/2)
        // and multiplying by 4.
        this.column_ = ((data & 0xe) >> 1) * 4;
      }

      if (this.isColorPAC(char1)) {
        // it's a color code, though we only support white, which
        // can be either normal or italicized. white italics can be
        // either 0x4e or 0x6e depending on the row, so we just
        // bitwise-and with 0xe to see if italics should be turned on
        if ((char1 & 0xe) === 0xe) {
          this.addFormatting(packet.pts, ['i']);
        }
      }

    // We have a normal character in char0, and possibly one in char1
    } else if (this.isNormalChar(char0)) {
      if (char1 === 0x00) {
        char1 = null;
      }
      text = getCharFromCode(char0);
      text += getCharFromCode(char1);
      this[this.mode_](packet.pts, text);
      this.column_ += text.length;

    } // finish data processing

  };
};
Cea608Stream.prototype = new stream();
// Trigger a cue point that captures the current state of the
// display buffer
Cea608Stream.prototype.flushDisplayed = function(pts) {
  var content = this.displayed_
    // remove spaces from the start and end of the string
    .map(function(row) {
      return row.trim();
    })
    // combine all text rows to display in one cue
    .join('\n')
    // and remove blank rows from the start and end, but not the middle
    .replace(/^\n+|\n+$/g, '');

  if (content.length) {
    this.trigger('data', {
      startPts: this.startPts_,
      endPts: pts,
      text: content,
      stream: this.name_
    });
  }
};

/**
 * Zero out the data, used for startup and on seek
 */
Cea608Stream.prototype.reset = function() {
  this.mode_ = 'popOn';
  // When in roll-up mode, the index of the last row that will
  // actually display captions. If a caption is shifted to a row
  // with a lower index than this, it is cleared from the display
  // buffer
  this.topRow_ = 0;
  this.startPts_ = 0;
  this.displayed_ = createDisplayBuffer();
  this.nonDisplayed_ = createDisplayBuffer();
  this.lastControlCode_ = null;

  // Track row and column for proper line-breaking and spacing
  this.column_ = 0;
  this.row_ = BOTTOM_ROW;
  this.rollUpRows_ = 2;

  // This variable holds currently-applied formatting
  this.formatting_ = [];
};

/**
 * Sets up control code and related constants for this instance
 */
Cea608Stream.prototype.setConstants = function() {
  // The following attributes have these uses:
  // ext_ :    char0 for mid-row codes, and the base for extended
  //           chars (ext_+0, ext_+1, and ext_+2 are char0s for
  //           extended codes)
  // control_: char0 for control codes, except byte-shifted to the
  //           left so that we can do this.control_ | CONTROL_CODE
  // offset_:  char0 for tab offset codes
  //
  // It's also worth noting that control codes, and _only_ control codes,
  // differ between field 1 and field2. Field 2 control codes are always
  // their field 1 value plus 1. That's why there's the "| field" on the
  // control value.
  if (this.dataChannel_ === 0) {
    this.BASE_     = 0x10;
    this.EXT_      = 0x11;
    this.CONTROL_  = (0x14 | this.field_) << 8;
    this.OFFSET_   = 0x17;
  } else if (this.dataChannel_ === 1) {
    this.BASE_     = 0x18;
    this.EXT_      = 0x19;
    this.CONTROL_  = (0x1c | this.field_) << 8;
    this.OFFSET_   = 0x1f;
  }

  // Constants for the LSByte command codes recognized by Cea608Stream. This
  // list is not exhaustive. For a more comprehensive listing and semantics see
  // http://www.gpo.gov/fdsys/pkg/CFR-2010-title47-vol1/pdf/CFR-2010-title47-vol1-sec15-119.pdf
  // Padding
  this.PADDING_                    = 0x0000;
  // Pop-on Mode
  this.RESUME_CAPTION_LOADING_     = this.CONTROL_ | 0x20;
  this.END_OF_CAPTION_             = this.CONTROL_ | 0x2f;
  // Roll-up Mode
  this.ROLL_UP_2_ROWS_             = this.CONTROL_ | 0x25;
  this.ROLL_UP_3_ROWS_             = this.CONTROL_ | 0x26;
  this.ROLL_UP_4_ROWS_             = this.CONTROL_ | 0x27;
  this.CARRIAGE_RETURN_            = this.CONTROL_ | 0x2d;
  // paint-on mode
  this.RESUME_DIRECT_CAPTIONING_   = this.CONTROL_ | 0x29;
  // Erasure
  this.BACKSPACE_                  = this.CONTROL_ | 0x21;
  this.ERASE_DISPLAYED_MEMORY_     = this.CONTROL_ | 0x2c;
  this.ERASE_NON_DISPLAYED_MEMORY_ = this.CONTROL_ | 0x2e;
};

/**
 * Detects if the 2-byte packet data is a special character
 *
 * Special characters have a second byte in the range 0x30 to 0x3f,
 * with the first byte being 0x11 (for data channel 1) or 0x19 (for
 * data channel 2).
 *
 * @param  {Integer} char0 The first byte
 * @param  {Integer} char1 The second byte
 * @return {Boolean}       Whether the 2 bytes are an special character
 */
Cea608Stream.prototype.isSpecialCharacter = function(char0, char1) {
  return (char0 === this.EXT_ && char1 >= 0x30 && char1 <= 0x3f);
};

/**
 * Detects if the 2-byte packet data is an extended character
 *
 * Extended characters have a second byte in the range 0x20 to 0x3f,
 * with the first byte being 0x12 or 0x13 (for data channel 1) or
 * 0x1a or 0x1b (for data channel 2).
 *
 * @param  {Integer} char0 The first byte
 * @param  {Integer} char1 The second byte
 * @return {Boolean}       Whether the 2 bytes are an extended character
 */
Cea608Stream.prototype.isExtCharacter = function(char0, char1) {
  return ((char0 === (this.EXT_ + 1) || char0 === (this.EXT_ + 2)) &&
    (char1 >= 0x20 && char1 <= 0x3f));
};

/**
 * Detects if the 2-byte packet is a mid-row code
 *
 * Mid-row codes have a second byte in the range 0x20 to 0x2f, with
 * the first byte being 0x11 (for data channel 1) or 0x19 (for data
 * channel 2).
 *
 * @param  {Integer} char0 The first byte
 * @param  {Integer} char1 The second byte
 * @return {Boolean}       Whether the 2 bytes are a mid-row code
 */
Cea608Stream.prototype.isMidRowCode = function(char0, char1) {
  return (char0 === this.EXT_ && (char1 >= 0x20 && char1 <= 0x2f));
};

/**
 * Detects if the 2-byte packet is an offset control code
 *
 * Offset control codes have a second byte in the range 0x21 to 0x23,
 * with the first byte being 0x17 (for data channel 1) or 0x1f (for
 * data channel 2).
 *
 * @param  {Integer} char0 The first byte
 * @param  {Integer} char1 The second byte
 * @return {Boolean}       Whether the 2 bytes are an offset control code
 */
Cea608Stream.prototype.isOffsetControlCode = function(char0, char1) {
  return (char0 === this.OFFSET_ && (char1 >= 0x21 && char1 <= 0x23));
};

/**
 * Detects if the 2-byte packet is a Preamble Address Code
 *
 * PACs have a first byte in the range 0x10 to 0x17 (for data channel 1)
 * or 0x18 to 0x1f (for data channel 2), with the second byte in the
 * range 0x40 to 0x7f.
 *
 * @param  {Integer} char0 The first byte
 * @param  {Integer} char1 The second byte
 * @return {Boolean}       Whether the 2 bytes are a PAC
 */
Cea608Stream.prototype.isPAC = function(char0, char1) {
  return (char0 >= this.BASE_ && char0 < (this.BASE_ + 8) &&
    (char1 >= 0x40 && char1 <= 0x7f));
};

/**
 * Detects if a packet's second byte is in the range of a PAC color code
 *
 * PAC color codes have the second byte be in the range 0x40 to 0x4f, or
 * 0x60 to 0x6f.
 *
 * @param  {Integer} char1 The second byte
 * @return {Boolean}       Whether the byte is a color PAC
 */
Cea608Stream.prototype.isColorPAC = function(char1) {
  return ((char1 >= 0x40 && char1 <= 0x4f) || (char1 >= 0x60 && char1 <= 0x7f));
};

/**
 * Detects if a single byte is in the range of a normal character
 *
 * Normal text bytes are in the range 0x20 to 0x7f.
 *
 * @param  {Integer} char  The byte
 * @return {Boolean}       Whether the byte is a normal character
 */
Cea608Stream.prototype.isNormalChar = function(char) {
  return (char >= 0x20 && char <= 0x7f);
};

/**
 * Configures roll-up
 *
 * @param  {Integer} pts         Current PTS
 * @param  {Integer} newBaseRow  Used by PACs to slide the current window to
 *                               a new position
 */
Cea608Stream.prototype.setRollUp = function(pts, newBaseRow) {
  // Reset the base row to the bottom row when switching modes
  if (this.mode_ !== 'rollUp') {
    this.row_ = BOTTOM_ROW;
    this.mode_ = 'rollUp';
    // Spec says to wipe memories when switching to roll-up
    this.flushDisplayed(pts);
    this.nonDisplayed_ = createDisplayBuffer();
    this.displayed_ = createDisplayBuffer();
  }

  if (newBaseRow !== undefined && newBaseRow !== this.row_) {
    // move currently displayed captions (up or down) to the new base row
    for (var i = 0; i < this.rollUpRows_; i++) {
      this.displayed_[newBaseRow - i] = this.displayed_[this.row_ - i];
      this.displayed_[this.row_ - i] = '';
    }
  }

  if (newBaseRow === undefined) {
    newBaseRow = this.row_;
  }
  this.topRow_ = newBaseRow - this.rollUpRows_ + 1;
};

// Adds the opening HTML tag for the passed character to the caption text,
// and keeps track of it for later closing
Cea608Stream.prototype.addFormatting = function(pts, format) {
  this.formatting_ = this.formatting_.concat(format);
  var text = format.reduce(function(text, format) {
    return text + '<' + format + '>';
  }, '');
  this[this.mode_](pts, text);
};

// Adds HTML closing tags for current formatting to caption text and
// clears remembered formatting
Cea608Stream.prototype.clearFormatting = function(pts) {
  if (!this.formatting_.length) {
    return;
  }
  var text = this.formatting_.reverse().reduce(function(text, format) {
    return text + '</' + format + '>';
  }, '');
  this.formatting_ = [];
  this[this.mode_](pts, text);
};

// Mode Implementations
Cea608Stream.prototype.popOn = function(pts, text) {
  var baseRow = this.nonDisplayed_[this.row_];

  // buffer characters
  baseRow += text;
  this.nonDisplayed_[this.row_] = baseRow;
};

Cea608Stream.prototype.rollUp = function(pts, text) {
  var baseRow = this.displayed_[this.row_];

  baseRow += text;
  this.displayed_[this.row_] = baseRow;

};

Cea608Stream.prototype.shiftRowsUp_ = function() {
  var i;
  // clear out inactive rows
  for (i = 0; i < this.topRow_; i++) {
    this.displayed_[i] = '';
  }
  for (i = this.row_ + 1; i < BOTTOM_ROW + 1; i++) {
    this.displayed_[i] = '';
  }
  // shift displayed rows up
  for (i = this.topRow_; i < this.row_; i++) {
    this.displayed_[i] = this.displayed_[i + 1];
  }
  // clear out the bottom row
  this.displayed_[this.row_] = '';
};

Cea608Stream.prototype.paintOn = function(pts, text) {
  var baseRow = this.displayed_[this.row_];

  baseRow += text;
  this.displayed_[this.row_] = baseRow;
};

// exports
var captionStream = {
  CaptionStream: CaptionStream,
  Cea608Stream: Cea608Stream
};
var captionStream_1 = captionStream.CaptionStream;

var streamTypes = {
  H264_STREAM_TYPE: 0x1B,
  ADTS_STREAM_TYPE: 0x0F,
  METADATA_STREAM_TYPE: 0x15
};

var
  percentEncode = function(bytes, start, end) {
    var i, result = '';
    for (i = start; i < end; i++) {
      result += '%' + ('00' + bytes[i].toString(16)).slice(-2);
    }
    return result;
  },
  // return the string representation of the specified byte range,
  // interpreted as UTf-8.
  parseUtf8 = function(bytes, start, end) {
    return decodeURIComponent(percentEncode(bytes, start, end));
  },
  // return the string representation of the specified byte range,
  // interpreted as ISO-8859-1.
  parseIso88591 = function(bytes, start, end) {
    return unescape(percentEncode(bytes, start, end)); // jshint ignore:line
  },
  parseSyncSafeInteger = function(data) {
    return (data[0] << 21) |
            (data[1] << 14) |
            (data[2] << 7) |
            (data[3]);
  },
  tagParsers = {
    TXXX: function(tag) {
      var i;
      if (tag.data[0] !== 3) {
        // ignore frames with unrecognized character encodings
        return;
      }

      for (i = 1; i < tag.data.length; i++) {
        if (tag.data[i] === 0) {
          // parse the text fields
          tag.description = parseUtf8(tag.data, 1, i);
          // do not include the null terminator in the tag value
          tag.value = parseUtf8(tag.data, i + 1, tag.data.length).replace(/\0*$/, '');
          break;
        }
      }
      tag.data = tag.value;
    },
    WXXX: function(tag) {
      var i;
      if (tag.data[0] !== 3) {
        // ignore frames with unrecognized character encodings
        return;
      }

      for (i = 1; i < tag.data.length; i++) {
        if (tag.data[i] === 0) {
          // parse the description and URL fields
          tag.description = parseUtf8(tag.data, 1, i);
          tag.url = parseUtf8(tag.data, i + 1, tag.data.length);
          break;
        }
      }
    },
    PRIV: function(tag) {
      var i;

      for (i = 0; i < tag.data.length; i++) {
        if (tag.data[i] === 0) {
          // parse the description and URL fields
          tag.owner = parseIso88591(tag.data, 0, i);
          break;
        }
      }
      tag.privateData = tag.data.subarray(i + 1);
      tag.data = tag.privateData;
    }
  },
  MetadataStream;

MetadataStream = function(options) {
  var
    settings = {
      debug: !!(options && options.debug),

      // the bytes of the program-level descriptor field in MP2T
      // see ISO/IEC 13818-1:2013 (E), section 2.6 "Program and
      // program element descriptors"
      descriptor: options && options.descriptor
    },
    // the total size in bytes of the ID3 tag being parsed
    tagSize = 0,
    // tag data that is not complete enough to be parsed
    buffer = [],
    // the total number of bytes currently in the buffer
    bufferSize = 0,
    i;

  MetadataStream.prototype.init.call(this);

  // calculate the text track in-band metadata track dispatch type
  // https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track
  this.dispatchType = streamTypes.METADATA_STREAM_TYPE.toString(16);
  if (settings.descriptor) {
    for (i = 0; i < settings.descriptor.length; i++) {
      this.dispatchType += ('00' + settings.descriptor[i].toString(16)).slice(-2);
    }
  }

  this.push = function(chunk) {
    var tag, frameStart, frameSize, frame, i, frameHeader;
    if (chunk.type !== 'timed-metadata') {
      return;
    }

    // if data_alignment_indicator is set in the PES header,
    // we must have the start of a new ID3 tag. Assume anything
    // remaining in the buffer was malformed and throw it out
    if (chunk.dataAlignmentIndicator) {
      bufferSize = 0;
      buffer.length = 0;
    }

    // ignore events that don't look like ID3 data
    if (buffer.length === 0 &&
        (chunk.data.length < 10 ||
          chunk.data[0] !== 'I'.charCodeAt(0) ||
          chunk.data[1] !== 'D'.charCodeAt(0) ||
          chunk.data[2] !== '3'.charCodeAt(0))) {
      if (settings.debug) {
        // eslint-disable-next-line no-console
        console.log('Skipping unrecognized metadata packet');
      }
      return;
    }

    // add this chunk to the data we've collected so far

    buffer.push(chunk);
    bufferSize += chunk.data.byteLength;

    // grab the size of the entire frame from the ID3 header
    if (buffer.length === 1) {
      // the frame size is transmitted as a 28-bit integer in the
      // last four bytes of the ID3 header.
      // The most significant bit of each byte is dropped and the
      // results concatenated to recover the actual value.
      tagSize = parseSyncSafeInteger(chunk.data.subarray(6, 10));

      // ID3 reports the tag size excluding the header but it's more
      // convenient for our comparisons to include it
      tagSize += 10;
    }

    // if the entire frame has not arrived, wait for more data
    if (bufferSize < tagSize) {
      return;
    }

    // collect the entire frame so it can be parsed
    tag = {
      data: new Uint8Array(tagSize),
      frames: [],
      pts: buffer[0].pts,
      dts: buffer[0].dts
    };
    for (i = 0; i < tagSize;) {
      tag.data.set(buffer[0].data.subarray(0, tagSize - i), i);
      i += buffer[0].data.byteLength;
      bufferSize -= buffer[0].data.byteLength;
      buffer.shift();
    }

    // find the start of the first frame and the end of the tag
    frameStart = 10;
    if (tag.data[5] & 0x40) {
      // advance the frame start past the extended header
      frameStart += 4; // header size field
      frameStart += parseSyncSafeInteger(tag.data.subarray(10, 14));

      // clip any padding off the end
      tagSize -= parseSyncSafeInteger(tag.data.subarray(16, 20));
    }

    // parse one or more ID3 frames
    // http://id3.org/id3v2.3.0#ID3v2_frame_overview
    do {
      // determine the number of bytes in this frame
      frameSize = parseSyncSafeInteger(tag.data.subarray(frameStart + 4, frameStart + 8));
      if (frameSize < 1) {
         // eslint-disable-next-line no-console
        return console.log('Malformed ID3 frame encountered. Skipping metadata parsing.');
      }
      frameHeader = String.fromCharCode(tag.data[frameStart],
                                        tag.data[frameStart + 1],
                                        tag.data[frameStart + 2],
                                        tag.data[frameStart + 3]);


      frame = {
        id: frameHeader,
        data: tag.data.subarray(frameStart + 10, frameStart + frameSize + 10)
      };
      frame.key = frame.id;
      if (tagParsers[frame.id]) {
        tagParsers[frame.id](frame);

        // handle the special PRIV frame used to indicate the start
        // time for raw AAC data
        if (frame.owner === 'com.apple.streaming.transportStreamTimestamp') {
          var
            d = frame.data,
            size = ((d[3] & 0x01)  << 30) |
                   (d[4]  << 22) |
                   (d[5] << 14) |
                   (d[6] << 6) |
                   (d[7] >>> 2);

          size *= 4;
          size += d[7] & 0x03;
          frame.timeStamp = size;
          // in raw AAC, all subsequent data will be timestamped based
          // on the value of this frame
          // we couldn't have known the appropriate pts and dts before
          // parsing this ID3 tag so set those values now
          if (tag.pts === undefined && tag.dts === undefined) {
            tag.pts = frame.timeStamp;
            tag.dts = frame.timeStamp;
          }
          this.trigger('timestamp', frame);
        }
      }
      tag.frames.push(frame);

      frameStart += 10; // advance past the frame header
      frameStart += frameSize; // advance past the frame body
    } while (frameStart < tagSize);
    this.trigger('data', tag);
  };
};
MetadataStream.prototype = new stream();

var metadataStream = MetadataStream;

/**
 * Creates a representation object for the level
 *
 * @param {Function} enabledCallback
 *        Callback to call when the representation's enabled property is updated
 * @param {Object} level
 *        The level to make a representation from
 * @return {Object}
 *         The representation object for this level
 */
var createRepresentation = function createRepresentation(enabledCallback, level) {
  var representation = {
    id: level.index + '',
    width: level.width,
    height: level.height,
    bandwidth: level.bitrate,
    isEnabled_: true
  };

  representation.enabled = function (enable) {
    if (typeof enable === 'undefined') {
      return representation.isEnabled_;
    }

    if (enable === representation.isEnabled_) {
      return;
    }

    if (enable === true || enable === false) {
      representation.isEnabled_ = enable;
      enabledCallback();
    }
  };

  return representation;
};
/**
 * Creates the list of representations and returns a function to use the api
 *
 * @param {Object} tech
 *        The flash tech
 * @return {Function}
 *         Function used to get the list of representations
 */

var createRepresentations = function createRepresentations(tech) {
  var representations = null;

  var updateEnabled = function updateEnabled() {
    var enabledRepresentations = representations.filter(function (rep) {
      return rep.enabled();
    }); // if all representations are enabled or all are disabled, enter auto mode and
    // disable auto capping

    if (enabledRepresentations.length === representations.length || enabledRepresentations.length === 0) {
      tech.el_.vjs_setProperty('autoLevelCapping', -1);
      tech.el_.vjs_setProperty('level', -1);
      return;
    } // if only one representation is enabled, enter manual level mode


    if (enabledRepresentations.length === 1) {
      tech.el_.vjs_setProperty('level', parseInt(enabledRepresentations[0].id, 10));
      tech.el_.vjs_setProperty('autoLevelCapping', -1);
      return;
    } // otherwise enter auto mode and set auto level capping to highest bitrate
    // representation


    var autoCap = enabledRepresentations[enabledRepresentations.length - 1].id;
    tech.el_.vjs_setProperty('autoLevelCapping', parseInt(autoCap, 10));
    tech.el_.vjs_setProperty('level', -1);
  };

  return function () {
    // populate representations on the first call
    if (!representations) {
      // FlasHLS returns levels pre-sorted by bitrate
      var levels = tech.el_.vjs_getProperty('levels'); // filter out levels that are audio only before mapping to representation objects

      representations = levels.filter(function (level) {
        return !level.audio;
      }).map(createRepresentation.bind(null, updateEnabled));
    }

    return representations;
  };
};

/**
 * Updates the selected index of the audio track list with the new active track
 *
 * @param {Object} tech
 *        The flash tech
 * @function updateAudioTrack
 */

var updateAudioTrack = function updateAudioTrack(tech) {
  var audioTracks = tech.el_.vjs_getProperty('audioTracks');
  var vjsAudioTracks = tech.audioTracks();
  var enabledTrackId = null;

  for (var i = 0; i < vjsAudioTracks.length; i++) {
    if (vjsAudioTracks[i].enabled) {
      enabledTrackId = vjsAudioTracks[i].id;
      break;
    }
  }

  if (enabledTrackId === null) {
    // no tracks enabled, do nothing
    return;
  }

  for (var _i = 0; _i < audioTracks.length; _i++) {
    if (enabledTrackId === audioTracks[_i].title) {
      tech.el_.vjs_setProperty('audioTrack', _i);
      return;
    }
  }
};
/**
 * This adds the videojs audio track to the audio track list
 *
 * @param {Object} tech
 *        The flash tech
 * @function onTrackChanged
 */

var setupAudioTracks = function setupAudioTracks(tech) {
  var altAudioTracks = tech.el_.vjs_getProperty('altAudioTracks');
  var audioTracks = tech.el_.vjs_getProperty('audioTracks');
  var enabledIndex = tech.el_.vjs_getProperty('audioTrack');
  audioTracks.forEach(function (track, index) {
    var altTrack = altAudioTracks[track.id];
    tech.audioTracks().addTrack(new videojs.AudioTrack({
      id: altTrack.name,
      enabled: enabledIndex === index,
      language: altTrack.lang,
      default: altTrack.default_track,
      label: altTrack.name
    }));
  });
};

var version = "1.4.5";

/**
 * Define properties on a cue for backwards compatability,
 * but warn the user that the way that they are using it
 * is depricated and will be removed at a later date.
 *
 * @param {Cue} cue the cue to add the properties on
 * @private
 */

var deprecateOldCue = function deprecateOldCue(cue) {
  Object.defineProperties(cue.frame, {
    id: {
      get: function get() {
        videojs.log.warn('cue.frame.id is deprecated. Use cue.value.key instead.');
        return cue.value.key;
      }
    },
    value: {
      get: function get() {
        videojs.log.warn('cue.frame.value is deprecated. Use cue.value.data instead.');
        return cue.value.data;
      }
    },
    privateData: {
      get: function get() {
        videojs.log.warn('cue.frame.privateData is deprecated. Use cue.value.data instead.');
        return cue.value.data;
      }
    }
  });
};
/**
 * Remove text track from tech
 */


var removeExistingTrack = function removeExistingTrack(tech, kind, label) {
  var tracks = tech.remoteTextTracks() || [];

  for (var i = 0; i < tracks.length; i++) {
    var track = tracks[i];

    if (track.kind === kind && track.label === label) {
      tech.removeRemoteTextTrack(track);
    }
  }
};
/**
 * convert a string to a byte array of char codes
 */


var stringToByteArray = function stringToByteArray(data) {
  var bytes = new Uint8Array(data.length);

  for (var i = 0; i < data.length; i++) {
    bytes[i] = data.charCodeAt(i);
  }

  return bytes;
};
/**
 * Remove cues from a track on video.js.
 *
 * @param {Double} start start of where we should remove the cue
 * @param {Double} end end of where the we should remove the cue
 * @param {Object} track the text track to remove the cues from
 * @private
 */


var removeCuesFromTrack = function removeCuesFromTrack(start, end, track) {
  var i;
  var cue;

  if (!track) {
    return;
  }

  if (!track.cues) {
    return;
  }

  i = track.cues.length;

  while (i--) {
    cue = track.cues[i]; // Remove any overlapping cue

    if (cue.startTime <= end && cue.endTime >= start) {
      track.removeCue(cue);
    }
  }
};
/**
 * Removes cues from the track that come before the start of the buffer
 *
 * @param {TimeRanges} buffered state of the buffer
 * @param {TextTrack} track track to remove cues from
 * @private
 * @function removeOldCues
 */


var removeOldCues = function removeOldCues(buffered, track) {
  if (buffered.length) {
    removeCuesFromTrack(0, buffered.start(0), track);
  }
};
/**
 * Updates the selected index of the quality levels list and triggers a change event
 *
 * @param {QualityLevelList} qualityLevels
 *        The quality levels list
 * @param {string} id
 *        The id of the new active quality level
 * @function updateSelectedIndex
 */


var updateSelectedIndex = function updateSelectedIndex(qualityLevels, id) {
  var selectedIndex = -1;

  for (var i = 0; i < qualityLevels.length; i++) {
    if (qualityLevels[i].id === id) {
      selectedIndex = i;
      break;
    }
  }

  qualityLevels.selectedIndex_ = selectedIndex;
  qualityLevels.trigger({
    selectedIndex: selectedIndex,
    type: 'change'
  });
}; // Fudge factor to account for TimeRanges rounding


var TIME_FUDGE_FACTOR = 1 / 30;

var filterRanges = function filterRanges(timeRanges, predicate) {
  var results = [];

  if (timeRanges && timeRanges.length) {
    // Search for ranges that match the predicate
    for (var i = 0; i < timeRanges.length; i++) {
      if (predicate(timeRanges.start(i), timeRanges.end(i))) {
        results.push([timeRanges.start(i), timeRanges.end(i)]);
      }
    }
  }

  return videojs.createTimeRanges(results);
};
/**
 * Attempts to find the buffered TimeRange that contains the specified
 * time.
 *
 * @param {TimeRanges} buffered - the TimeRanges object to query
 * @param {number} time  - the time to filter on.
 * @return {TimeRanges} a new TimeRanges object
 */


var findRange = function findRange(buffered, time) {
  return filterRanges(buffered, function (start, end) {
    return start - TIME_FUDGE_FACTOR <= time && end + TIME_FUDGE_FACTOR >= time;
  });
};

var FlashlsHandler =
/*#__PURE__*/
function () {
  function FlashlsHandler(source, tech, options) {
    var _this = this;

    // tech.player() is deprecated but setup a reference to HLS for
    // backwards-compatibility
    if (tech.options_ && tech.options_.playerId) {
      var _player = videojs(tech.options_.playerId);

      if (!_player.hasOwnProperty('hls')) {
        Object.defineProperty(_player, 'hls', {
          get: function get() {
            videojs.log.warn('player.hls is deprecated. Use player.tech_.hls instead.');
            tech.trigger({
              type: 'usage',
              name: 'flashls-player-access'
            });
            return _this;
          }
        });
      }
    }

    Object.defineProperties(this, {
      stats: {
        get: function get() {
          return this.tech_.el_.vjs_getProperty('stats');
        }
      },
      bandwidth: {
        get: function get() {
          return this.tech_.el_.vjs_getProperty('stats').bandwidth;
        }
      }
    });
    this.tech_ = tech;
    this.metadataTrack_ = null;
    this.inbandTextTracks_ = {};
    this.metadataStream_ = new metadataStream();
    this.captionStream_ = new captionStream_1(); // bind event listeners to this context

    this.onLoadedmetadata_ = this.onLoadedmetadata_.bind(this);
    this.onSeeking_ = this.onSeeking_.bind(this);
    this.onId3updated_ = this.onId3updated_.bind(this);
    this.onCaptionData_ = this.onCaptionData_.bind(this);
    this.onMetadataStreamData_ = this.onMetadataStreamData_.bind(this);
    this.onCaptionStreamData_ = this.onCaptionStreamData_.bind(this);
    this.onLevelSwitch_ = this.onLevelSwitch_.bind(this);
    this.onLevelLoaded_ = this.onLevelLoaded_.bind(this);
    this.onFragmentLoaded_ = this.onFragmentLoaded_.bind(this);
    this.onAudioTrackChanged = this.onAudioTrackChanged.bind(this);
    this.onPlay_ = this.onPlay_.bind(this);
    this.tech_.on('loadedmetadata', this.onLoadedmetadata_);
    this.tech_.on('seeking', this.onSeeking_);
    this.tech_.on('id3updated', this.onId3updated_);
    this.tech_.on('captiondata', this.onCaptionData_);
    this.tech_.on('levelswitch', this.onLevelSwitch_);
    this.tech_.on('levelloaded', this.onLevelLoaded_);
    this.tech_.on('fragmentloaded', this.onFragmentLoaded_);
    this.tech_.on('play', this.onPlay_);
    this.metadataStream_.on('data', this.onMetadataStreamData_);
    this.captionStream_.on('data', this.onCaptionStreamData_);
    this.playlists = new videojs.EventTarget();

    this.playlists.media = function () {
      return _this.media_();
    };
  }

  var _proto = FlashlsHandler.prototype;

  _proto.src = function src(source) {
    // do nothing if source is falsey
    if (!source) {
      return;
    }

    this.tech_.setSrc(source.src);
  };

  _proto.onPlay_ = function onPlay_() {
    // if the viewer has paused and we fell out of the live window,
    // seek forward to the live point
    if (this.tech_.duration() === Infinity) {
      var seekable = this.seekable();

      if (this.tech_.currentTime() < seekable.start(0)) {
        return this.tech_.setCurrentTime(seekable.end(seekable.length - 1));
      }
    }
  };
  /**
   * Calculates the interval of time that is currently seekable.
   *
   * @return {TimeRange}
   *         Returns the time ranges that can be seeked to.
   */


  _proto.seekable = function seekable() {
    var seekableStart = this.tech_.el_.vjs_getProperty('seekableStart');
    var seekableEnd = this.tech_.el_.vjs_getProperty('seekableEnd');
    var duration = this.tech_.el_.vjs_getProperty('duration');

    if (seekableEnd !== 0 && duration !== 0) {
      return videojs.createTimeRange(seekableStart, seekableEnd);
    } else if (duration !== 0) {
      return videojs.createTimeRange(0, duration);
    }

    return videojs.createTimeRange();
  };

  _proto.media_ = function media_() {
    var levels = this.tech_.el_.vjs_getProperty('levels');
    var level = this.tech_.el_.vjs_getProperty('level');
    var media;

    if (levels.length) {
      media = {
        resolvedUri: levels[level].url,
        attributes: {
          BANDWIDTH: levels[level].bitrate,
          RESOLUTION: {
            width: levels[level].width,
            height: levels[level].height
          }
        }
      };
    }

    return media;
  };
  /**
   * Event listener for the loadedmetadata event. This sets up the representations api
   * and populates the quality levels list if it is available on the player
   */


  _proto.onLoadedmetadata_ = function onLoadedmetadata_() {
    var _this2 = this;

    this.representations = createRepresentations(this.tech_);
    var player = videojs.players[this.tech_.options_.playerId];

    if (player && player.qualityLevels) {
      this.qualityLevels_ = player.qualityLevels();
      this.representations().forEach(function (representation) {
        _this2.qualityLevels_.addQualityLevel(representation);
      }); // update initial selected index

      updateSelectedIndex(this.qualityLevels_, this.tech_.el_.vjs_getProperty('level') + '');
    }

    setupAudioTracks(this.tech_);
    this.tech_.audioTracks().on('change', this.onAudioTrackChanged);
  };
  /**
   * Event listener for the change event. This will update the selected index of the
   * audio track list with the new active track.
   */


  _proto.onAudioTrackChanged = function onAudioTrackChanged() {
    updateAudioTrack(this.tech_);
  };
  /**
   * Event listener for the levelswitch event. This will update the selected index of the
   * quality levels list with the new active level.
   *
   * @param {Object} event
   *        event object for the levelswitch event
   * @param {Array} level
   *        The active level will be the first element of the array
   */


  _proto.onLevelSwitch_ = function onLevelSwitch_(event, level) {
    if (this.qualityLevels_) {
      updateSelectedIndex(this.qualityLevels_, level[0].levelIndex + '');
    }

    this.playlists.trigger('mediachange');
    this.tech_.trigger({
      type: 'mediachange',
      bubbles: true
    });
  };
  /**
   * Event listener for the levelloaded event.
   */


  _proto.onLevelLoaded_ = function onLevelLoaded_() {
    this.playlists.trigger('loadedplaylist');
  };
  /**
   * Event listener for the fragmentloaded event.
   */


  _proto.onFragmentLoaded_ = function onFragmentLoaded_() {
    this.tech_.trigger('bandwidthupdate');
    this.captionStream_.flush();
  };
  /**
   * Event listener for the seeking event. This will remove cues from the metadata track
   * and inband text tracks during seeks
   */


  _proto.onSeeking_ = function onSeeking_() {
    var _this3 = this;

    removeCuesFromTrack(0, Infinity, this.metadataTrack_);
    var buffered = findRange(this.tech_.buffered(), this.tech_.currentTime());

    if (!buffered.length) {
      Object.keys(this.inbandTextTracks_).forEach(function (id) {
        removeCuesFromTrack(0, Infinity, _this3.inbandTextTracks_[id]);
      });
      this.captionStream_.reset();
    }
  };
  /**
   * Event listener for the id3updated event. This will store id3 tags recevied by flashls
   *
   * @param {Object} event
   *        event object for the levelswitch event
   * @param {Array} data
   *        The id3 tag base64 encoded will be the first element of the array
   */


  _proto.onId3updated_ = function onId3updated_(event, data) {
    var id3tag = window.atob(data[0]);
    var bytes = stringToByteArray(id3tag);
    var chunk = {
      type: 'timed-metadata',
      dataAlignmentIndicator: true,
      data: bytes
    };
    this.metadataStream_.push(chunk);
  };
  /**
   * Event listener for the data event from the metadata stream. This will create cues
   * for each frame in the metadata tag and add them to the metadata track
   *
   * @param {Object} tag
   *        The metadata tag
   */


  _proto.onMetadataStreamData_ = function onMetadataStreamData_(tag) {
    var _this4 = this;

    if (!this.metadataTrack_) {
      this.metadataTrack_ = this.tech_.addRemoteTextTrack({
        kind: 'metadata',
        label: 'Timed Metadata'
      }, false).track;
      this.metadataTrack_.inBandMetadataTrackDispatchType = '';
    }

    removeOldCues(this.tech_.buffered(), this.metadataTrack_);
    var time = this.tech_.currentTime();
    tag.frames.forEach(function (frame) {
      var cue = new window.VTTCue(time, time + 0.1, frame.value || frame.url || frame.data || '');
      cue.frame = frame;
      cue.value = frame;
      deprecateOldCue(cue);

      _this4.metadataTrack_.addCue(cue);
    });

    if (this.metadataTrack_.cues && this.metadataTrack_.cues.length) {
      var cues = this.metadataTrack_.cues;
      var cuesArray = [];
      var duration = this.tech_.duration();

      if (isNaN(duration) || Math.abs(duration) === Infinity) {
        duration = Number.MAX_VALUE;
      }

      for (var i = 0; i < cues.length; i++) {
        cuesArray.push(cues[i]);
      }

      cuesArray.sort(function (a, b) {
        return a.startTime - b.startTime;
      });

      for (var _i = 0; _i < cuesArray.length - 1; _i++) {
        if (cuesArray[_i].endTime !== cuesArray[_i + 1].startTime) {
          cuesArray[_i].endTime = cuesArray[_i + 1].startTime;
        }
      }

      cuesArray[cuesArray.length - 1].endTime = duration;
    }
  };
  /**
   * Event listener for the captiondata event from FlasHLS. This will parse out the
   * caption data and feed it to the CEA608 caption stream.
   *
   * @param {Object} event
   *        The captiondata event object
   * @param {Array} data
   *        The caption packets array will be the first element of data.
   */


  _proto.onCaptionData_ = function onCaptionData_(event, data) {
    var _this5 = this;

    data[0].forEach(function (d) {
      _this5.captionStream_.push({
        pts: d.pos * 90000,
        dts: d.dts * 90000,
        escapedRBSP: stringToByteArray(window.atob(d.data)),
        nalUnitType: 'sei_rbsp'
      });
    });
  };
  /**
   * Event listener for the data event from the CEA608 caption stream. This will create
   * cues for the captions received from the stream and add them to the inband text track
   *
   * @param {Object} caption
   *        The caption object
   */


  _proto.onCaptionStreamData_ = function onCaptionStreamData_(caption) {
    if (caption) {
      if (!this.inbandTextTracks_[caption.stream]) {
        removeExistingTrack(this.tech_, 'captions', caption.stream);
        this.inbandTextTracks_[caption.stream] = this.tech_.addRemoteTextTrack({
          kind: 'captions',
          label: caption.stream,
          id: caption.stream
        }, false).track;
      }

      removeOldCues(this.tech_.buffered(), this.inbandTextTracks_[caption.stream]);
      this.inbandTextTracks_[caption.stream].addCue(new window.VTTCue(caption.startPts / 90000, caption.endPts / 90000, caption.text));
    }
  };

  _proto.dispose = function dispose() {
    this.tech_.off('loadedmetadata', this.onLoadedmetadata_);
    this.tech_.off('seeked', this.onSeeking_);
    this.tech_.off('id3updated', this.onId3updated_);
    this.tech_.off('captiondata', this.onCaptionData_);
    this.tech_.audioTracks().off('change', this.onAudioTrackChanged);
    this.tech_.off('levelswitch', this.onLevelSwitch_);
    this.tech_.off('levelloaded', this.onLevelLoaded_);
    this.tech_.off('fragmentloaded', this.onFragmentLoaded_);
    this.tech_.off('play', this.onPlay_);

    if (this.qualityLevels_) {
      this.qualityLevels_.dispose();
    }
  };

  return FlashlsHandler;
}();
/*
 * Registers the SWF as a handler for HLS video.
 *
 * @property {Tech~SourceObject} source
 *           The source object
 *
 * @property {Flash} tech
 *           The instance of the Flash tech
 */

var FlashlsSourceHandler = {};
var mpegurlRE = /^(audio|video|application)\/(x-|vnd\.apple\.)?mpegurl/i;
/**
 * Reports that Flash can play HLS.
 *
 * @param {string} type
 *        The mimetype to check
 *
 * @return {string}
 *         'maybe', or '' (empty string)
 */

FlashlsSourceHandler.canPlayType = function (type) {
  return mpegurlRE.test(type) ? 'maybe' : '';
};
/**
 * Returns true if the source type indicates HLS content.
 *
 * @param {Tech~SourceObject} source
 *         The source object
 *
 * @param {Object} [options]
 *         Options to be passed to the tech.
 *
 * @return {string}
 *         'maybe', or '' (empty string).
 */


FlashlsSourceHandler.canHandleSource = function (source, options) {
  return FlashlsSourceHandler.canPlayType(source.type) === 'maybe';
};
/**
 * Pass the source to the swf.
 *
 * @param {Tech~SourceObject} source
 *        The source object
 *
 * @param {Flash} tech
 *        The instance of the Flash tech
 *
 * @param {Object} [options]
 *        The options to pass to the source
 */


FlashlsSourceHandler.handleSource = function (source, tech, options) {
  tech.hls = new FlashlsHandler(source, tech, options);
  tech.hls.src(source);
  return tech.hls;
}; // Register the source handler and make sure it takes precedence over
// any other Flash source handlers for HLS


videojs.getTech('Flash').registerSourceHandler(FlashlsSourceHandler, 0); // Include the version number.

FlashlsSourceHandler.VERSION = version;

exports.FlashlsHandler = FlashlsHandler;
exports.default = FlashlsSourceHandler;
