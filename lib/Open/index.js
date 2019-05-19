var fs = require('fs');
var Promise = require('bluebird');
var directory = require('./directory');
var Stream = require('stream');
var binary = require('binary');

// Backwards compatibility for node versions < 8
if (!Stream.Writable || !Stream.Writable.prototype.destroy)
  Stream = require('readable-stream');

module.exports = {
  buffer: function(buffer) {  
    // slice the buffer to correct start location if crx files
    var signature = buffer.readUInt32LE(0);
    if (signature === 0x34327243) {
      var baseHeaderLength = 4*4;
      var h = binary.parse(buffer)
        .word32lu('signature')
        .word32lu('version')
        .word32lu('pubKeyLength')
        .word32lu('signatureLength')
        .vars;

      buffer = buffer.slice(baseHeaderLength +  h.pubKeyLength + h.signatureLength);
    }

    var source = {
      stream: function(offset, length) {
        var stream = Stream.PassThrough();
        stream.end(buffer.slice(offset, length));
        return stream;
      },
      size: function() {
        return Promise.resolve(buffer.length);
      }
    };
    return directory(source);
  },
  file: function(filename) {
    var source = {
      stream: function(offset,length) {
        return fs.createReadStream(filename,{start: offset, end: length && offset+length});
      },
      size: function() {
        return new Promise(function(resolve,reject) {
          fs.stat(filename,function(err,d) {
            if (err)
              reject(err);
            else
              resolve(d.size);
          });
        });
      }
    };
    return directory(source);
  },

  url: function(request,opt) {
    if (typeof opt === 'string')
      opt = {url: opt};
    if (!opt.url)
      throw 'URL missing';
    opt.headers = opt.headers || {};

    var source = {
      stream : function(offset,length) {
        var options = Object.create(opt);
        options.headers = Object.create(opt.headers);
        options.headers.range = 'bytes='+offset+'-' + (length ? length : '');
        return request(options);
      },
      size: function() {
        return new Promise(function(resolve,reject) {
          var req = request(opt);
          req.on('response',function(d) {
            req.abort();
            resolve(d.headers['content-length']);
          }).on('error',reject);
        });
      }
    };

    return directory(source);
  },

  s3 : function(client,params) {
    var source = {
      size: function() {
        return new Promise(function(resolve,reject) {
          client.headObject(params, function(err,d) {
            if (err)
              reject(err);
            else
              resolve(d.ContentLength);
          });
        });
      },
      stream: function(offset,length) {
        var d = {};
        for (var key in params)
          d[key] = params[key];
        d.Range = 'bytes='+offset+'-' + (length ? length : '');
        return client.getObject(d).createReadStream();
      }
    };

    return directory(source);
  }
};
