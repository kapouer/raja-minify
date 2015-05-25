var queue = require('queue-async');

var postcss = require('postcss');
var postcssUrl = require("postcss-url");
var uglify = require('uglify-js');
var autoprefixer = require('autoprefixer-core');
var csswring = require('csswring');
var debug = require('debug')('raja:minify');


// require('raja-minify')(raja, opts);
module.exports = function(raja, opts) {
	if (!opts) opts = {};
	if (opts.minify == null) opts.minify = true;
	if (raja.proxies.dom) {
		raja.proxies.dom.Dom.author(domAuthorMinify.bind(null, raja, opts), 'after');
	}
	raja.builders.minify = buildResource.bind(null, opts);
};

function domAuthorMinify(raja, opts, page, resource) {
	debug('minify on', resource.key);
	page.run(domTransform, !!opts.minify, function(err, groups, cb) {
		if (err) return cb(err);
		build(raja, groups, opts, cb);
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
		var resource;
		nodes.forEach(function(node) {
			if (!node.hasAttribute(att) || !node.getAttribute(att)) return;
			var single = !node.hasAttribute('to');
			if (single && !minify) return;
			if (!resource || single) {
				resource = {nodes: []};
				groups.push(resource);
			}
			resource.nodes.push(node);
			if (node.getAttribute('to') || single) resource = null;
		});
		groups.forEach(function(resource) {
			var resources = {};
			var last = resource.nodes.slice(-1).pop();
			resource.nodes.forEach(function(node) {
				resources[node[att]] = true;
				if (node != last) {
					var next = node.nextSibling;
					while (next && next.nodeType == 3) {
						next.parentNode.removeChild(next);
						next = next.nextSibling;
					}
					node.parentNode.removeChild(node);
				} else {
					node[att] = renameTo(node.getAttribute(att), node.getAttribute('to') || node.getAttribute(att));
					resource.url = node[att]; // absolute
					node.removeAttribute('to');
				}
			});
			delete resource.nodes;
			resource.resources = resources;
			resource.headers = {'Content-Type': mime};
		});
		return groups;
	}

	var scripts = getGroups('script', 'src', 'text/javascript');
	var styles = getGroups('link[rel="stylesheet"]', 'href', 'text/css');
	done(null, scripts.concat(styles));
}

function build(raja, groups, opts, cb) {
	if (groups.length == 0) return cb();
	var q = queue();
	var upsert = raja.upsert.bind(raja);
	groups.forEach(function(resource) {
		resource.builder = 'minify';
		q.defer(upsert, resource);
	});
	q.awaitAll(function(err, resources) {
		if (err) return cb(err);
		q = queue();
		resources.forEach(function(resource) {
			q.defer(buildResource, opts, resource);
		});
		q.awaitAll(function(err) {
			cb(err);
		});
	});
}

function buildResource(opts, resource, cb) {
	if (resource.is("text/css")) {
		batch(resource, processCss, resultCss, opts, cb);
	} else if (!opts.minify) {
		batch(resource, process, result, opts, cb);
	} else if (resource.is("text/javascript")) {
		batch(resource, processJs, resultJs, opts, cb);
	} else {
		console.log(resource)
		cb(new Error("raja-minify cannot process resource " + resource.url));
	}
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
	var parsed = postcss.parse(data, {from: url, safe: true});
	postcssUrl({url: "rebase"})(parsed, {from: url, to: to});
	autoprefixer({ browsers: opts.browsers }).postcss(parsed);
	if (opts.minify) csswring({preserveHacks: true}).postcss(parsed);
	if (!cur) cur = parsed;
	else cur.push(parsed);
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

function batch(resource, process, result, opts, cb) {
	var q = queue();
	var cur;
	var load = resource.load.bind(resource);
	Object.keys(resource.resources).forEach(function(url) {
		debug("minify is loading", url);
		q.defer(load, url);
	});
	q.awaitAll(function(err, resources) {
		if (err) return cb(err);
		resources.forEach(function(child) {
			debug('minifying', child.url);
			cur = process(resource.url, child.url, child.data, cur, opts);
		});
		if (!cur) return cb(new Error("Missing current parsed object for " + resource.url));
		resource.data = result(resource.url, cur);
		debug('minified', resource.url);
		resource.save(cb);
	});
}

