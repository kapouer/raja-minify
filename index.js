var queue = require('queue-async');

var postcss = require('postcss');
var postcssUrl = require("postcss-url");
var uglify = require('uglify-js');
var autoprefixer = require('autoprefixer-core');
var csswring = require('csswring');


// require('raja-minify')(raja, opts);
module.exports = function(raja, opts) {
	if (!opts) opts = {};
	if (opts.minify == null) opts.minify = true;
	if (raja.proxies.dom) {
		raja.proxies.dom.Dom.author(domAuthorMinify.bind(null, raja, opts), 'after');
	}
};

function domAuthorMinify(raja, opts, h, req, res) {
	h.page.run(domTransform, !!opts.minify, function(err, groups, cb) {
		if (err) return cb(err);
		build(raja, h.author.url, groups, opts, cb);
	});
}

function domTransform(minify, done) {
	function renameTo(src, to) {
		if (src != to) {
			if (to[0] == '../' || to[0] == './' || to[0] != '/') {
				// remove last component from src
				src = src.split('/');
				src.pop();
				src.push(to);
				to = src.join('/');
			}
		}
		var split = to.split('.');
		split.splice(-1, 0, 'min');
		to = split.join('.');
		return to;
	}
	function getGroups(selector, att, mime) {
		var groups = [];
		var nodes = Array.prototype.slice.call(document.querySelectorAll(selector));
		var group;
		nodes.forEach(function(node) {
			if (!node.hasAttribute(att) || !node.getAttribute(att)) return;
			var single = !node.hasAttribute('to');
			if (single && !minify) return;
			if (!group || single) {
				group = {list: []};
				groups.push(group);
			}
			group.list.push(node);
			if (node.getAttribute('to') || single) group = null;
		});
		groups.forEach(function(group) {
			var list = [];
			var last = group.list.slice(-1).pop();
			group.list.forEach(function(node) {
				list.push({src: node[att]});
				if (node != last) {
					var next = node.nextSibling;
					while (next && next.nodeType == 3) {
						next.parentNode.removeChild(next);
						next = next.nextSibling;
					}
					node.parentNode.removeChild(node);
				} else {
					node[att] = renameTo(node.getAttribute(att), node.getAttribute('to') || node.getAttribute(att));
					group.to = node[att]; // absolute
					node.removeAttribute('to');
				}
			});
			group.list = list;
			delete group.last;
			group.mime = mime;
		});
		return groups;
	}

	var scripts = getGroups('script', 'src', 'text/javascript');
	var styles = getGroups('link[rel="stylesheet"]', 'href', 'text/css');
	done(null, scripts.concat(styles));
}

function build(raja, authorUrl, groups, opts, cb) {
	if (groups.length == 0) return cb();
	var q = queue();
	groups.forEach(function(group) {
		q.defer(function(group, cb) {
			raja.retrieve(group.to, function(err, resource) {
				if (!resource) resource = raja.create(group.to).save();
				resource.headers = {
					"Content-Type": group.mime
				};
				group.resource = resource;
				cb();
			});
		}, group);
	});
	q.awaitAll(function(err) {
		if (err) return cb(err);
		q = queue();
		groups.forEach(function(group) {
			if (group.mime == "text/css") {
				q.defer(batch, group.resource, group.list, processCss, resultCss, opts);
			} else if (!opts.minify) {
				q.defer(batch, group.resource, group.list, process, result, opts);
			} else if (group.mime == "text/javascript") {
				q.defer(batch, group.resource, group.list, processJs, resultJs, opts);
			} else {
				console.warn("raja-minify has unknown group");
			}
		});
		q.awaitAll(function(err) {
			cb(err);
		});
	});
}

function process(to, url, data, cur, opts) {
	if (Buffer.isBuffer(data)) data = data.toString();
	if (!cur) cur = [];
	cur.push(data);
	return cur;
}

function result(to, cur) {
	return cur.join("\n");
}

function processCss(to, url, data, cur, opts) {
	if (Buffer.isBuffer(data)) data = data.toString();
	var parsed = postcss.parse(data, {from: url});
	postcssUrl({url: "rebase"})(parsed, {from: url, to: to});
	autoprefixer({ browsers: opts.browsers }).postcss(parsed);
	if (opts.minify) csswring({preserveHacks: true}).postcss(parsed);
	if (!cur) cur = parsed;
	else cur.append(parsed);
	return cur;
}

function resultCss(to, cur) {
	return cur.toResult({to: to}).toString();
}

function processJs(to, url, data, cur, opts) {
	if (Buffer.isBuffer(data)) data = data.toString();
	cur = uglify.parse(data, {filename: url, toplevel: cur});
	return cur;
}

function resultJs(to, cur) {
	cur.figure_out_scope();
	cur.compute_char_frequency();
	cur.mangle_names();
	var source_map = uglify.SourceMap();
	return cur.print_to_string({source_map: source_map});
}

function batch(resource, list, process, result, opts, cb) {
	var q = queue();
	var cur;
	list.forEach(function(obj) {
		q.defer(function(obj, cb) {
			if (obj.src) {
				resource.load(obj.src, function(err, data) {
					if (err) return cb(err);
					obj.data = data;
					cb(null, obj);
				});
			} else if (obj.text) {
				obj.data = obj.text;
				cb(null, obj);
			} else {
				cb();
			}
		}, obj);
	});
	q.awaitAll(function(err, list) {
		if (err) return cb(err);
		list.forEach(function(obj) {
			cur = process(resource.url, obj.src, obj.data, cur, opts);
		});
		if (!cur) return cb(new Error("Missing current parsed object for " + resource.url));
		resource.data = result(resource.url, cur);
		resource.save();
		cb();
	});
}

