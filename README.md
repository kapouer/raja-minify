raja-minify
===========

Super simple minification and concatenation for html pages proxied by raja.

After initialization of raja in your express app,

require('raja-minify')(raja);

will automatically minify scripts and stylesheets:

```
<script src="dir/file1.js"></script>
```

is replaced by
```
<script src="dir/file1.min.js"></script>
```


The "to" attribute allows one to rename a file, relative to current path:

```
<script to="fileA.js" src="dir/file1.js"></script>
<script to="../dir2/file2.js" src="dir/file2.js"></script>
<script to="/dir3/file3.js" src="dir/file3.js"></script>
```

is replaced by

```
<script src="dir/fileA.min.js"></script>
<script src="dir2/file2.min.js"></script>
<script src="/dir3/file3.min.js"></script>
```


Concatenation is done by setting successive "to" attributes.
Appending ends with the first non-empty "to" attribute, or the first node
without a "to" attribute.

```
<script src="dir/file1.js" to></script>
<script src="dir/file2.js" to></script>
<script src="dir/file3.js"></script>
```

and result in

```
<script src="dir/file2.min.js"></script>
<script src="dir/file3.min.js"></script>
```

or with renaming:
```
<script src="dir/file1.js" to></script>
<script src="dir/file2.js" to="../root.js"></script>
<script src="dir/file3.js" to></script>
<script src="dir/file4.js" to="lib2.js"></script>
```
and result in
```
<script src="root.min.js"></script>
<script src="dir/lib2.min.js"></script>
```

and likewise for CSS, with automatic url rebasing, autoprefixer filters, so that

```
<link rel="stylesheet" href="subdir/style1.css" to />
<link rel="stylesheet" href="style2.css" to="common.css" />
```
has its url paths in style1.css fixed (thanks to postcss-url) so that
```
<link rel="stylesheet" href="common.css" />
```
is all right.


Planned feature(s)
------------------

* Ability to pass options to uglify-js, autoprefixer-core, csswring.
* Automatic source maps - you don't even know you generated them.

