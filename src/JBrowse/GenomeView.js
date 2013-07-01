define([
           'dojo/_base/declare',
           'dojo/_base/array',
           'dojo/dom-construct',
           'dojo/on',
           'dojo/mouse',
           'JBrowse/Util',
           'JBrowse/has',
           'dojo/dnd/move',
           'dojo/dnd/Source',
           'dijit/focus',
           'dijit/form/ComboBox',
           'dijit/form/Button',
           'dijit/form/Select',
           'dijit/form/HorizontalSlider',
           'JBrowse/Component',
           'JBrowse/FeatureFiltererMixin',
           'JBrowse/View/Track/LocationScale',
           'JBrowse/View/Track/GridLines',
           'JBrowse/BehaviorManager',
           'JBrowse/View/Animation/Zoomer',
           'JBrowse/View/Animation/Slider',
           'JBrowse/View/InfoDialog'
       ], function(
           declare,
           array,
           domConstruct,
           on,
           mouse,
           Util,
           has,
           dndMove,
           dndSource,
           dijitFocus,
           dijitComboBox,
           dijitButton,
           dijitSelectBox,
           dijitSlider,
           Component,
           FeatureFiltererMixin,
           LocationScaleTrack,
           GridLinesTrack,
           BehaviorManager,
           Zoomer,
           Slider,
           InfoDialog
       ) {

var dojof = Util.dojof;

/**
 * Main view class, shows a scrollable, horizontal view of annotation
 * tracks.  NOTE: All coordinates are interbase.
 * @class
 * @constructor
 */

return declare( [Component,FeatureFiltererMixin], {

constructor: function( args ) {
    var browser = args.browser;
    var elem = args.elem;
    var stripeWidth = args.stripeWidth;
    var refseq = args.refSeq;
    var zoomLevel = args.zoomLevel;

    // keep a reference to the main browser object
    this.browser = browser;
    this.setFeatureFilterParentComponent( this.browser );

    //the page element that the GenomeView lives in
    this.navbox = this.createNavBox( elem );

    // this.elem = elem;
    // elem.className = 'dragWindow';

    this.elem = domConstruct.create('div', {
        className: 'dragWindow', style: "width: 100%; height: 100%; position: absolute"
    }, elem );

    this.posHeight = this.calculatePositionLabelHeight( this.elem );
    // Add an arbitrary 50% padding between the position labels and the
    // topmost track
    this.topSpace = this.posHeight*1.5;

    // WebApollo needs max zoom level to be sequence residues char width
    this.maxPxPerBp = this.config.maxPxPerBp;

    //the reference sequence
    this.ref = refseq;
    //current scale, in pixels per bp
    this.pxPerBp = zoomLevel;

    //width, in pixels, of the vertical stripes
    this.stripeWidth = stripeWidth;


    // the scrollContainer is the element that changes position
    // when the user scrolls
    this.scrollContainer = dojo.create(
        'div', {
            id: 'container',
            style: { position: 'relative',
                     // left: '0px',
                     // top: '0px'
                   }
        }, this.elem
    );

    this._renderVerticalScrollBar();

    // we have a separate zoomContainer as a child of the scrollContainer.
    // they used to be the same element, but making zoomContainer separate
    // enables it to be narrower than this.elem.
    this.zoomContainer = document.createElement("div");
    this.zoomContainer.id = "zoomContainer";
    this.zoomContainer.style.cssText =
        "position: absolute; left: 0px; top: 0px; height: 100%;";
    this.scrollContainer.appendChild(this.zoomContainer);

    this.outerTrackContainer = document.createElement("div");
    this.outerTrackContainer.className = "trackContainer outerTrackContainer";
    this.outerTrackContainer.style.cssText = "height: 100%;";
    this.zoomContainer.appendChild( this.outerTrackContainer );

    this.trackContainer = document.createElement("div");
    this.trackContainer.className = "trackContainer innerTrackContainer draggable";
    this.trackContainer.style.cssText = "height: 100%;";
    this.outerTrackContainer.appendChild( this.trackContainer );

    //width, in pixels of the "regular" (not min or max zoom) stripe
    this.regularStripe = stripeWidth;

    //width, in pixels, of stripes at full zoom, is 10bp
    this.fullZoomStripe = stripeWidth/10 * this.maxPxPerBp;

    this.tracks = [];
    this.uiTracks = [];
    this.trackIndices = {};

    //set up size state (zoom levels, stripe percentage, etc.)
    this.sizeInit();

    //distance, in pixels, from the beginning of the reference sequence
    //to the beginning of the first active stripe
    //  should always be a multiple of stripeWidth
    this.offset = 0;
    //largest value for the sum of this.offset and this.getX()
    //this prevents us from scrolling off the right end of the ref seq
    this.maxLeft = this.bpToPx(this.ref.end+1) - this.getWidth();
    //smallest value for the sum of this.offset and this.getX()
    //this prevents us from scrolling off the left end of the ref seq
    this.minLeft = this.bpToPx(this.ref.start);
    //distance, in pixels, between each track
    this.trackPadding = 20;
    //extra margin to draw around the visible area, in multiples of the visible area
    //0: draw only the visible area; 0.1: draw an extra 10% around the visible area, etc.
    this.drawMargin = 0.2;
    //slide distance (pixels) * slideTimeMultiple + 200 = milliseconds for slide
    //1=1 pixel per millisecond average slide speed, larger numbers are slower
    this.slideTimeMultiple = 0.8;
    this.trackHeights = [];
    this.trackTops = [];
    this.waitElems = dojo.filter( [ dojo.byId("moveLeft"), dojo.byId("moveRight"),
                                    dojo.byId("zoomIn"), dojo.byId("zoomOut"),
                                    dojo.byId("bigZoomIn"), dojo.byId("bigZoomOut"),
                                    document.body, this.elem ],
                                  function(e) { return e; }
                                );
    this.prevCursors = [];

    this.x = this.elem.scrollLeft;
    this.y = 0;

    var scaleTrackDiv = document.createElement("div");
    scaleTrackDiv.className = "track viewscale rubberBandAvailable";
    scaleTrackDiv.style.height = this.posHeight + "px";

    this.scaleTrackDiv = scaleTrackDiv;
    this.staticTrack = new LocationScaleTrack({
        label: "static_track",
        labelClass: "pos-label",
        posHeight: this.posHeight,
        browser: this.browser,
        refSeq: this.ref
    });
    this.staticTrack.setViewInfo( this, function(height) {}, this.stripeCount,
                                 this.scaleTrackDiv, this.stripePercent,
                                 this.stripeWidth, this.pxPerBp,
                                 this.trackPadding);
    this.zoomContainer.appendChild(this.scaleTrackDiv);
    this.waitElems.push(this.scaleTrackDiv);

    var gridTrackDiv = document.createElement("div");
    gridTrackDiv.className = "track";
    gridTrackDiv.style.cssText = "top: 0px; height: 100%;";
    gridTrackDiv.id = "gridtrack";
    var gridTrack = new GridLinesTrack({
                                           browser: this.browser,
                                           refSeq: this.ref
                                       });
    gridTrack.setViewInfo( this, function(height) {}, this.stripeCount,
                          gridTrackDiv, this.stripePercent,
                          this.stripeWidth, this.pxPerBp,
                          this.trackPadding);
    this.trackContainer.appendChild(gridTrackDiv);
    this.uiTracks = [this.staticTrack, gridTrack];

    // accept tracks being dragged into this
    this.trackDndWidget =
        new dndSource(
            this.trackContainer,
            {
                accept: ["track"], //accepts only tracks into the viewing field
                withHandles: true,
                creator: dojo.hitch( this, function( trackConfig, hint ) {
                    return {
                        data: trackConfig,
                        type: ["track"],
                        node: hint == 'avatar'
                                 ? dojo.create('div', { innerHTML: trackConfig.key || trackConfig.label, className: 'track-label dragging' })
                                 : this.renderTrack( trackConfig )
                    };
                })
            });

    // subscribe to showTracks commands
    this.browser.subscribe(
        '/dnd/drop',
        dojo.hitch(
            this,
            function( source, nodes, copy, target ) {
                this.updateTrackList();
                if( target.node === this.trackContainer ) {
                    // if dragging into the trackcontainer, we are showing some tracks
                    // get the configs from the tracks being dragged in
                    var confs = dojo.filter( dojo.map( nodes, function(n) {
                                                           return n.track && n.track.config;
                                                       }),
                                             function(c) {return c;}
                                           );
                    this.browser.publish( '/jbrowse/v1/v/tracks/show', confs );
                }
            }
        )
    );
    this.browser.subscribe( '/jbrowse/v1/c/tracks/show',    dojo.hitch( this, 'showTracks' ));
    this.browser.subscribe( '/jbrowse/v1/c/tracks/hide',    dojo.hitch( this, 'hideTracks' ));
    this.browser.subscribe( '/jbrowse/v1/c/tracks/replace', dojo.hitch( this, 'replaceTracks' ));
    this.browser.subscribe( '/jbrowse/v1/c/tracks/delete',  dojo.hitch( this, 'hideTracks' ));
    this.browser.subscribe( '/jbrowse/v1/c/tracks/pin',     dojo.hitch( this, 'pinTracks' ));
    this.browser.subscribe( '/jbrowse/v1/c/tracks/unpin',   dojo.hitch( this, 'unpinTracks' ));

    // render our UI tracks (horizontal scale tracks, grid lines, and so forth)
    dojo.forEach(this.uiTracks, function(track) {
        track.showRange(0, this.stripeCount - 1,
                        Math.round(this.pxToBp(this.offset)),
                        Math.round(this.stripeWidth / this.pxPerBp),
                        this.pxPerBp);
    }, this);

    this.zoomContainer.style.paddingTop = this.topSpace + "px";

    this.showFine();
    this.showCoarse();

    // initialize the behavior manager used for setting what this view
    // does (i.e. the behavior it has) for mouse and keyboard events
    this.behaviorManager = new BehaviorManager({ context: this, behaviors: this._behaviors() });
    this.behaviorManager.initialize();
},


_defaultConfig: function() {
    return {
        maxPxPerBp: 20
    };
},

/**
 * @returns {Object} containing ref, start, and end members for the currently displayed location
 */
visibleRegion: function() {
    return {
               ref:   this.ref.name,
               start: this.minVisible(),
               end:   this.maxVisible()
           };
},

/**
 * @returns {String} locstring representation of the current location<br>
 * (suitable for passing to the browser's navigateTo)
 */
visibleRegionLocString: function() {
    return Util.assembleLocString( this.visibleRegion() );
},

/**
 * Create and place the elements for the vertical scrollbar.
 * @private
 */
_renderVerticalScrollBar: function() {
    var container = dojo.create(
        'div',
        {
            className: 'vertical_scrollbar',
            style: { position: 'fixed',
                     right: '0px',
                     bottom: '0px',
                     height: '100%',
                     width: '10px',
                     zIndex: 1000
                   }
        },
        this.elem
    );

    var positionMarker = dojo.create(
        'div',
        {
            className: 'vertical_position_marker',
            style: {
                position: 'absolute',
                height: '100%'
            }
        },
        container
    );
    this.verticalScrollBar = { container: container, positionMarker: positionMarker };
},

/**
 * Update the position and look of the vertical scroll bar as our
 * y-scroll offset changes.
 * @private
 */
_updateVerticalScrollBar: function( newDims ) {
    if( typeof newDims.height == 'number' ) {
        var heightAdjust = this.staticTrack ? -this.staticTrack.div.offsetHeight : 0;
        var trackPaneHeight = newDims.height + heightAdjust;
        this.verticalScrollBar.container.style.height = trackPaneHeight-(this.pinUnderlay ? this.pinUnderlay.offsetHeight+heightAdjust : 0 ) +'px';
        var markerHeight = newDims.height / (this.containerHeight||1) * 100;
        this.verticalScrollBar.positionMarker.style.height = markerHeight > 0.5 ? markerHeight+'%' :  '1px';
        this.verticalScrollBar.container.style.display = newDims.height / (this.containerHeight||1) > 0.98 ? 'none' : 'block';
    }

    if( typeof newDims.y == 'number' || typeof newDims.height == 'number' ) {
        this.verticalScrollBar.positionMarker.style.top    = (((newDims.y || this.getY() || 0) / (this.containerHeight||1) * 100 )||0)+'%';
    }

},

/**
 * @returns {Array[Track]} of the tracks that are currently visible in
 * this genomeview
 */
visibleTracks: function() {
    return this.tracks;
},

/**
 *  @returns {Array[String]} of the names of tracks that are currently visible in this genomeview
 */
visibleTrackNames: function() {
    return dojo.map( this.visibleTracks(), function(t){ return t.name; } );
},


/**
 * Behaviors (event handler bundles) for various states that the
 * GenomeView might be in.
 * @private
 * @returns {Object} description of behaviors
 */
_behaviors: function() { return {

    // behaviors that don't change
    always: {
        apply_on_init: true,
        apply: function() {
            var handles = [];
            handles.push(
                dojo.connect( this.scrollContainer,     "mousewheel",     this, 'wheelScroll', false ),
                dojo.connect( this.scrollContainer,     "DOMMouseScroll", this, 'wheelScroll', false ),

                dojo.connect( this.scaleTrackDiv,       "mousedown",
                              dojo.hitch( this, 'startRubberZoom',
                                          dojo.hitch( this,'absXtoBp'),
                                          this.scrollContainer,
                                          this.scaleTrackDiv
                                        )
                            ),

                dojo.connect( this.outerTrackContainer, "dblclick",       this, 'doubleClickZoom'    ),



                dojo.connect( this.scaleTrackDiv,       "onclick",        this,  'scaleClicked'      ),
                dojo.connect( this.scaleTrackDiv,       "mouseover",      this,  'scaleMouseOver'    ),
                dojo.connect( this.scaleTrackDiv,       "mouseout",       this,  'scaleMouseOut'     ),
                dojo.connect( this.scaleTrackDiv,       "mousemove",      this,  'scaleMouseMove'    ),

                // when the mouse leaves the document, need to cancel
                // any keyboard-modifier-holding-down state
                dojo.connect( document.body,            'onmouseleave',       this, function() {
                    this.behaviorManager.swapBehaviors('shiftMouse','normalMouse');
                }),

                // when the mouse leaves the document, need to cancel
                // any keyboard-modifier-holding-down state
                dojo.connect( document.body,            'onmouseenter',       this, function(evt) {
                    if( evt.shiftKey )
                        this.behaviorManager.swapBehaviors( 'normalMouse', 'shiftMouse' );
                }),

                dojo.connect( document.body, 'onkeyup', this, function(evt) {
                    if( evt.keyCode == dojo.keys.SHIFT ) // shift
                        this.behaviorManager.swapBehaviors( 'shiftMouse', 'normalMouse' );
                }),
                dojo.connect( document.body, 'onkeydown', this, function(evt) {
                    if( evt.keyCode == dojo.keys.SHIFT ) // shift
                        this.behaviorManager.swapBehaviors( 'normalMouse', 'shiftMouse' );
                }),

                // scroll the view around in response to keyboard arrow keys
                dojo.connect( document.body, 'onkeypress', this, function(evt) {

                    // if some digit widget is focused, don't move the
                    // genome view with arrow keys
                    if( dijitFocus.curNode )
                        return;

                    var that = this;
                    if( evt.keyCode == dojo.keys.LEFT_ARROW || evt.keyCode == dojo.keys.RIGHT_ARROW ) {

                        var offset = evt.keyCode == dojo.keys.LEFT_ARROW ? -40 : 40;
                        if( evt.shiftKey )
                            offset *= 5;

                        this.setX( this.getX() + offset );
                        if( ! this._keySlideTimeout )
                            this._keySlideTimeout = window.setTimeout(function() {
                                that.afterSlide();
                                delete that._keySlideTimeout;
                            }, 300 );
                    }
                    else if( evt.keyCode == dojo.keys.DOWN_ARROW || evt.keyCode == dojo.keys.UP_ARROW ) {
                        // shift-up/down zooms in and out
                        if( evt.shiftKey ) {
                            this[ evt.keyCode == dojo.keys.UP_ARROW ? 'zoomIn' : 'zoomOut' ]( evt, 0.5, evt.altKey ? 2 : 1 );
                        }
                        // without shift, scrolls up and down
                        else {
                            var offset = evt.keyCode == dojo.keys.UP_ARROW ? -40 : 40;
                            this.setY( this.getY() + offset );
                        }
                    }
                }),

                // when the track pane is clicked, unfocus any dijit
                // widgets that would otherwise not give up the focus
                dojo.connect( this.scrollContainer, 'onclick', this, function(evt) {
                    dijitFocus.curNode && dijitFocus.curNode.blur();
                })
            );
            return handles;
        }
    },

    // mouse events connected for "normal" behavior
    normalMouse: {
        apply_on_init: true,
        apply: function() {
            return [
                dojo.connect( this.outerTrackContainer,         "mousedown", this, 'startMouseDragScroll'        ),
                dojo.connect( this.verticalScrollBar.container, "mousedown", this, 'startVerticalMouseDragScroll')
            ];
        }
    },

    // mouse events connected when the shift button is being held down
    shiftMouse: {
        apply: function() {
            // function that draws the vertical position line only if
            // we are not rubberbanding
            var maybeDrawVerticalPositionLine = dojo.hitch( this, function( evt ) {
                if( this.rubberbanding )
                    return;
                this.drawVerticalPositionLine( this.outerTrackContainer, evt );
            });

            dojo.removeClass(this.trackContainer,'draggable');
            dojo.addClass(this.trackContainer,'rubberBandAvailable');
            return [
                dojo.connect( this.outerTrackContainer, "mousedown",
                              dojo.hitch( this, 'startRubberZoom',
                                          dojo.hitch(this,'absXtoBp'),
                                          this.scrollContainer,
                                          this.scaleTrackDiv
                                        )
                            ),
                dojo.connect( this.outerTrackContainer, "onclick",   this, 'scaleClicked'              ),
                dojo.connect( this.outerTrackContainer, "mouseover", maybeDrawVerticalPositionLine ),
                dojo.connect( this.outerTrackContainer, "mousemove", maybeDrawVerticalPositionLine )
            ];
        },
        remove: function( mgr, handles ) {
            this.clearBasePairLabels();
            this.clearVerticalPositionLine();
            dojo.forEach( handles, dojo.disconnect, dojo );
            dojo.removeClass(this.trackContainer,'rubberBandAvailable');
            dojo.addClass(this.trackContainer,'draggable');
        }
    },

    // mouse events that are connected when we are in the middle of a
    // drag-scrolling operation
    mouseDragScrolling: {
        apply: function() {
            return [
                dojo.connect(document.body, "mouseup",   this, 'dragEnd'      ),
                dojo.connect(document.body, "mousemove", this, 'dragMove'     ),
                dojo.connect(document.body, "mouseout",  this, 'checkDragOut' )
            ];
        }
    },

    // mouse events that are connected when we are in the middle of a
    // vertical-drag-scrolling operation
    verticalMouseDragScrolling: {
        apply: function() {
            return [
                dojo.connect(document.body, "mouseup",   this, 'dragEnd'         ),
                dojo.connect(document.body, "mousemove", this, 'verticalDragMove'),
                dojo.connect(document.body, "mouseout",  this, 'checkDragOut'    )
            ];
        }
    },

    // mouse events that are connected when we are in the middle of a
    // rubber-band zooming operation
    mouseRubberBandZooming: {
        apply: function() {
            return [
                dojo.connect(document.body, "mouseup",    this, 'rubberExecute'                                        ),
                dojo.connect(document.body, "mousemove",  this, 'rubberMove'                                           ),
                dojo.connect(document.body, "mouseout",   this, 'rubberCancel'                                         ),
                dojo.connect(window,        "onkeydown",  this, function(e){if(e.keyCode !== dojo.keys.SHIFT){ this.rubberCancel(e);} }  )
            ];
        }
    }
};},

/**
 * Conduct a DOM test to calculate the height of div.pos-label
 * elements with a line of text in them.
 */
calculatePositionLabelHeight: function( containerElement ) {
    // measure the height of some arbitrary text in whatever font this
    // shows up in (set by an external CSS file)
    var heightTest = document.createElement("div");
    heightTest.className = "pos-label";
    heightTest.style.visibility = "hidden";
    heightTest.appendChild(document.createTextNode("42"));
    containerElement.appendChild(heightTest);
    var h = heightTest.clientHeight;
    containerElement.removeChild(heightTest);
    return h;
},

wheelScroll: function(e) {

    // 60 pixels per mouse wheel event
    this.setY( this.getY() - 60 * Util.wheel(e) );

    //the timeout is so that we don't have to run showVisibleBlocks
    //for every scroll wheel click (we just wait until so many ms
    //after the last one).
    if ( this.wheelScrollTimeout )
        window.clearTimeout( this.wheelScrollTimeout );

    // 100 milliseconds since the last scroll event is an arbitrary
    // cutoff for deciding when the user is done scrolling
    // (set by a bit of experimentation)
    this.wheelScrollTimeout = window.setTimeout( dojo.hitch( this, function() {
        this.showVisibleBlocks(true);
        this.wheelScrollTimeout = null;
    }, 100));

    dojo.stopEvent(e);
},

getX: function() {
    return this.x || 0;
},

getY: function() {
    return this.y || 0;
},
getHeight: function() {
    return this.elem.offsetHeight;
},
getWidth: function() {
    return this.elem.offsetWidth;
},

clampX: function(x) {
    return Math.round( Math.max( Math.min( this.maxLeft - this.offset, x || 0),
                                 this.minLeft - this.offset
                               )
                     );
},

clampY: function(y) {
    return Math.round( Math.min( Math.max( 0, y || 0 ),
                                 this.containerHeight- this.getHeight()
                               )
                     );
},

rawSetX: function(x) {
    this.elem.scrollLeft = x;
    this.x = x;
},

/**
 * @returns the new x value that was set
 */
setX: function(x) {
    x = this.clampX(x);
    this.rawSetX( x );
    this.updateStaticElements( { x: x } );
    this.showFine();
    return x;
},

rawSetY: function(y) {
    this.y = y;
    this.layoutTracks();
},

/**
 * @returns the new y value that was set
 */
setY: function(y) {
    y = this.clampY(y);
    this.rawSetY(y);
    this.updateStaticElements( { y: y } );
    return y;
},

/**
 * @private
 */
rawSetPosition: function(pos) {
    this.rawSetX( pos.x );
    this.rawSetY( pos.y );
    return pos;
},

/**
 * @param pos.x new x position
 * @param pos.y new y position
 */
setPosition: function(pos) {
    var x = this.clampX( pos.x );
    var y = this.clampY( pos.y );
    this.updateStaticElements( {x: x, y: y} );
    this.rawSetX( x );
    this.rawSetY( y );
    this.showFine();
},

/**
 * @returns {Object} as <code>{ x: 123, y: 456 }</code>
 */
getPosition: function() {
    return { x: this.x, y: this.y };
},

zoomCallback: function() {
    this.zoomUpdate();
},

afterSlide: function() {
    this.showCoarse();
    this.scrollUpdate();
    this.showVisibleBlocks(true);
},

/**
 * Suppress double-click events in the genome view for a certain amount of time, default 100 ms.
 */
suppressDoubleClick: function( /** Number */ time ) {

    if( this._noDoubleClick ) {
        window.clearTimeout( this._noDoubleClick );
    }

    var thisB = this;
    this._noDoubleClick = window.setTimeout(
        function(){ delete thisB._noDoubleClick; },
        time || 100
    );
},

doubleClickZoom: function(event) {
    if( this._noDoubleClick ) return;
    if( this.dragging ) return;
    if( "animation" in this ) return;

    // if we have a timeout in flight from a scaleClicked click,
    // cancel it, cause it looks now like the user has actually
    // double-clicked
    if( this.scaleClickedTimeout ) window.clearTimeout( this.scaleClickedTimeout );

    var zoomLoc = (event.pageX - dojo.position(this.elem, true).x) / this.getWidth();
    if (event.shiftKey) {
    this.zoomOut(event, zoomLoc, 2);
    } else {
    this.zoomIn(event, zoomLoc, 2);
    }
    dojo.stopEvent(event);
},

/** @private */
_beforeMouseDrag: function( event ) {
    if ( this.animation ) {
        if (this.animation instanceof Zoomer) {
            dojo.stopEvent(event);
            return 0;

        } else {
            this.animation.stop();
        }
    }
    if (Util.isRightButton(event)) return 0;
    dojo.stopEvent(event);
    return 1;
},

/**
 * Event fired when a user's mouse button goes down inside the main
 * element of the genomeview.
 */
startMouseDragScroll: function(event) {
    if( ! this._beforeMouseDrag(event) ) return;

    this.behaviorManager.applyBehaviors('mouseDragScrolling');

    this.dragStartPos = {x: event.clientX,
                         y: event.clientY};
    this.winStartPos = this.getPosition();
},

/**
 * Event fired when a user's mouse button goes down inside the vertical
 * scroll bar element of the genomeview.
 */
startVerticalMouseDragScroll: function(event) {
    if( ! this._beforeMouseDrag(event) ) return; // not sure what this is for.

    this.behaviorManager.applyBehaviors('verticalMouseDragScrolling');

    this.dragStartPos = {x: event.clientX,
                         y: event.clientY};
    this.winStartPos = this.getPosition();
},

/**
 * Start a rubber-band dynamic zoom.
 *
 * @param {Function} absToBp function to convert page X coordinates to
 *   base pair positions on the reference sequence.  Called in the
 *   context of the GenomeView object.
 * @param {HTMLElement} container element in which to draw the
 *   rubberbanding highlight
 * @param {Event} event the mouse event that's starting the zoom
 */
startRubberZoom: function( absToBp, container, scaleDiv, event ) {
    if( ! this._beforeMouseDrag(event) ) return;

    this.behaviorManager.applyBehaviors('mouseRubberBandZooming');

    this.rubberbanding = { absFunc: absToBp, container: container, scaleDiv: scaleDiv };
    this.rubberbandStartPos = {x: event.clientX,
                               y: event.clientY};
    this.winStartPos = this.getPosition();
    this.clearVerticalPositionLine();
    this.clearBasePairLabels();
},

_rubberStop: function(event) {
    this.behaviorManager.removeBehaviors('mouseRubberBandZooming');
    this.hideRubberHighlight();
    this.clearBasePairLabels();
    dojo.stopEvent(event);
    delete this.rubberbanding;
},

rubberCancel: function(event) {
    var htmlNode = document.body.parentNode;
    var bodyNode = document.body;

    if ( !event || !(event.relatedTarget || event.toElement)
        || (htmlNode === (event.relatedTarget || event.toElement))
        || (bodyNode === (event.relatedTarget || event.toElement))) {
        this._rubberStop(event);
    }
},

rubberMove: function(event) {
    this.setRubberHighlight( this.rubberbandStartPos, { x: event.clientX, y: event.clientY } );
},

rubberExecute: function(event) {
    var start = this.rubberbandStartPos;
    var end   = { x: event.clientX, y: event.clientY };

    var h_start_bp = this.rubberbanding.absFunc( Math.min(start.x,end.x) );
    var h_end_bp   = this.rubberbanding.absFunc( Math.max(start.x,end.x) );

    this._rubberStop(event);

    // cancel the rubber-zoom if the user has moved less than 3 pixels
    if( Math.abs( start.x - end.x ) < 3 ) {
        return this._rubberStop(event);
    }

    this.setLocation( this.ref, h_start_bp, h_end_bp );
},

// draws the rubber-banding highlight region from start.x to end.x
setRubberHighlight: function( start, end ) {
    var container = this.rubberbanding.container,
        container_coords = dojo.position(container,true);

    var h = this.rubberHighlight || (function(){
        var main = this.rubberHighlight = document.createElement("div");
        main.className = 'rubber-highlight';
        main.style.position = 'absolute';
        main.style.zIndex = 20;
        var text = document.createElement('div');
        text.appendChild( document.createTextNode("Zoom to region") );
        main.appendChild(text);
        text.style.position = 'relative';
        text.style.top = (50-container_coords.y) + "px";

        container.appendChild( main );
        return main;
    }).call(this);

    h.style.visibility  = 'visible';
    h.style.left   = Math.min( start.x, end.x ) - container_coords.x + 'px';
    h.style.width  = Math.abs( end.x - start.x ) + 'px';

    // draw basepair-position labels for the start and end of the highlight
    this.drawBasePairLabel({ name: 'rubberLeft',
                             xToBp: this.rubberbanding.absFunc,
                             scaleDiv: this.rubberbanding.scaleDiv,
                             offset: 0,
                             x: Math.min( start.x, end.x ),
                             parent: container,
                             className: 'rubber'
                           });
    this.drawBasePairLabel({ name: 'rubberRight',
                             xToBp: this.rubberbanding.absFunc,
                             scaleDiv: this.rubberbanding.scaleDiv,
                             offset: 0,
                             x: Math.max( start.x, end.x ) + 1,
                             parent: container,
                             className: 'rubber'
                           });

    // turn off the red position line if it's on
    this.clearVerticalPositionLine();
},

dragEnd: function(event) {
    this.behaviorManager.removeBehaviors('mouseDragScrolling', 'verticalMouseDragScrolling');

    dojo.stopEvent(event);
    this.showCoarse();

    this.scrollUpdate();
    this.showVisibleBlocks(true);

    // wait 100 ms before releasing our drag indication, since onclick
    // events from during the drag might fire after the dragEnd event
    window.setTimeout(
        dojo.hitch(this,function() {this.dragging = false;}),
        100 );
},

/** stop the drag if we mouse out of the view */
checkDragOut: function( event ) {
    var htmlNode = document.body.parentNode;
    var bodyNode = document.body;

    if (!(event.relatedTarget || event.toElement)
        || (htmlNode === (event.relatedTarget || event.toElement))
        || (bodyNode === (event.relatedTarget || event.toElement))
       ) {
           this.dragEnd(event);
    }
},

dragMove: function(event) {
    this.dragging = true;
    this.setPosition({
        x: this.winStartPos.x - (event.clientX - this.dragStartPos.x),
        y: this.winStartPos.y - (event.clientY - this.dragStartPos.y)
        });
    dojo.stopEvent(event);
},

// Similar to "dragMove". Consider merging.
verticalDragMove: function(event) {
    this.dragging = true;
    var containerHeight = parseInt(this.verticalScrollBar.container.style.height,10);
    var trackContainerHeight = this.trackContainer.clientHeight;
     this.setPosition({
         x: this.winStartPos.x,
         y: this.winStartPos.y + (event.clientY - this.dragStartPos.y)*(trackContainerHeight/containerHeight)
         });
    dojo.stopEvent(event);
},

hideRubberHighlight: function( start, end ) {
    if( this.rubberHighlight ) {
       this.rubberHighlight.parentNode.removeChild( this.rubberHighlight );
       delete this.rubberHighlight;
    }
},

/* moves the view by (distance times the width of the view) pixels */
slide: function(distance) {
    if (this.animation) this.animation.stop();
    this.trimVertical();
    // slide for an amount of time that's a function of the distance being
    // traveled plus an arbitrary extra 200 milliseconds so that
    // short slides aren't too fast (200 chosen by experimentation)
    new Slider(this,
               this.afterSlide,
               Math.abs(distance) * this.getWidth() * this.slideTimeMultiple + 200,
               distance * this.getWidth());
},

setLocation: function(refseq, startbp, endbp) {
    if (startbp === undefined) startbp = this.minVisible();
    if (endbp === undefined) endbp = this.maxVisible();
    if ((startbp < refseq.start) || (startbp > refseq.end))
        startbp = refseq.start;
    if ((endbp < refseq.start) || (endbp > refseq.end))
        endbp = refseq.end;

    if (this.ref != refseq) {
    this.ref = refseq;
        this._unsetPosBeforeZoom();  // if switching to different sequence, flush zoom position tracking
    var removeTrack = function(track) {
            if (track.div && track.div.parentNode)
                track.div.parentNode.removeChild(track.div);
    };
    dojo.forEach(this.tracks, removeTrack);

        this.tracks = [];
        this.trackIndices = {};
        this.trackHeights = [];
        this.trackTops = [];

        dojo.forEach(this.uiTracks, function(track) { track.clear(); });

        this.sizeInit();
        this.setY(0);
        //this.containerHeight = this.topSpace;

        this.behaviorManager.initialize();
    }

    this.pxPerBp = Math.min(this.getWidth() / (endbp - startbp), this.maxPxPerBp );
    this.curZoom = Util.findNearest(this.zoomLevels, this.pxPerBp);

    if( has('inaccurate-html-layout') )
        this.pxPerBp = this.zoomLevels[ this.curZoom ];

    if (Math.abs(this.pxPerBp - this.zoomLevels[this.zoomLevels.length - 1]) < 0.2) {
        //the cookie-saved location is in round bases, so if the saved
        //location was at the highest zoom level, the new zoom level probably
        //won't be exactly at the highest zoom (which is necessary to trigger
        //the sequence track), so we nudge the zoom level to be exactly at
        //the highest level if it's close.
        //Exactly how close is arbitrary; 0.2 was chosen to be close
        //enough that people wouldn't notice if we fudged that much.
        //console.log("nudging zoom level from %d to %d", this.pxPerBp, this.zoomLevels[this.zoomLevels.length - 1]);
        this.pxPerBp = this.zoomLevels[this.zoomLevels.length - 1];
    }
    this.stripeWidth = (this.stripeWidthForZoom(this.curZoom) / this.zoomLevels[this.curZoom]) * this.pxPerBp;
    this.instantZoomUpdate();

    this.centerAtBase((startbp + endbp) / 2, true);
},

stripeWidthForZoom: function(zoomLevel) {
    if ((this.zoomLevels.length - 1) == zoomLevel) {
        return this.fullZoomStripe;
    } else if (0 == zoomLevel) {
        return this.minZoomStripe;
    } else {
        return this.regularStripe;
    }
},

instantZoomUpdate: function() {
    this.scrollContainer.style.width =
        (this.stripeCount * this.stripeWidth) + "px";
    this.zoomContainer.style.width =
        (this.stripeCount * this.stripeWidth) + "px";
    this.maxOffset =
        this.bpToPx(this.ref.end) - this.stripeCount * this.stripeWidth;
    this.maxLeft = this.bpToPx(this.ref.end+1) - this.getWidth();
    this.minLeft = this.bpToPx(this.ref.start);
},

centerAtBase: function(base, instantly) {
    base = Math.min(Math.max(base, this.ref.start), this.ref.end);
    if (instantly) {
    var pxDist = this.bpToPx(base);
    var containerWidth = this.stripeCount * this.stripeWidth;
    var stripesLeft = Math.floor((pxDist - (containerWidth / 2)) / this.stripeWidth);
    this.offset = stripesLeft * this.stripeWidth;
    this.setX(pxDist - this.offset - (this.getWidth() / 2));
    this.trackIterate(function(track) { track.clear(); });
    this.showVisibleBlocks(true);
        this.showCoarse();
    } else {
    var startbp = this.pxToBp(this.x + this.offset);
    var halfWidth = (this.getWidth() / this.pxPerBp) / 2;
    var endbp = startbp + halfWidth + halfWidth;
    var center = startbp + halfWidth;
    if ((base >= (startbp  - halfWidth))
        && (base <= (endbp + halfWidth))) {
        //we're moving somewhere nearby, so move smoothly
            if (this.animation) this.animation.stop();
            var distance = (center - base) * this.pxPerBp;
        this.trimVertical();
            // slide for an amount of time that's a function of the
            // distance being traveled plus an arbitrary extra 200
            // milliseconds so that short slides aren't too fast
            // (200 chosen by experimentation)
            new Slider(this, this.afterSlide,
                       Math.abs(distance) * this.slideTimeMultiple + 200,
               distance);
    } else {
        //we're moving far away, move instantly
        this.centerAtBase(base, true);
    }
    }
},

/**
 * @returns {Number} minimum basepair coordinate of the current
 * reference sequence visible in the genome view
 */
minVisible: function() {
    var mv = this.pxToBp(this.x + this.offset);

    // if we are less than one pixel from the beginning of the ref
    // seq, just say we are at the beginning.
    if( mv < this.pxToBp(1) )
        return 0;
    else
        return Math.round(mv);
},

/**
 * @returns {Number} maximum basepair coordinate of the current
 * reference sequence visible in the genome view
 */
maxVisible: function() {
    var mv = this.pxToBp(this.x + this.offset + this.getWidth());
    // if we are less than one pixel from the end of the ref
    // seq, just say we are at the end.
    if( mv > this.ref.end - this.pxToBp(1) )
        return this.ref.end;
    else
        return Math.round(mv);
},

showFine: function() {
    this.onFineMove(this.minVisible(), this.maxVisible());
},
showCoarse: function() {
    this.onCoarseMove(this.minVisible(), this.maxVisible());
},

/**
 * Hook for other components to dojo.connect to.
 */
onFineMove: function( startbp, endbp ) {
},

/**
 * Hook for other components to dojo.connect to.
 */
onCoarseMove: function( startbp, endbp ) {
    // update the location box with our current location
    this._updateLocationDisplays({ start: startbp, end: endbp, ref: this.ref.name });

    // also update the refseq selection dropdown if present
    this._updateRefSeqSelectBox();
},

/**
 * Hook to be called on a window resize.
 */
onResize: function() {
    this.sizeInit();
    this.showVisibleBlocks();
    this.showFine();
    this.showCoarse();
},

/**
 * Event handler fired when mouse is over the scale bar.
 */
scaleMouseOver: function( evt ) {
    if( ! this.rubberbanding )
        this.drawVerticalPositionLine( this.scaleTrackDiv, evt);
},

/**
 * Event handler fired when mouse moves over the scale bar.
 */
scaleMouseMove: function( evt ) {
    if( ! this.rubberbanding )
        this.drawVerticalPositionLine( this.scaleTrackDiv, evt);
},

/**
 * Event handler fired when mouse leaves the scale bar.
 */
scaleMouseOut: function( evt ) {
    this.clearVerticalPositionLine();
    this.clearBasePairLabels();
},

/**
 * Draws the red line across the work area, or updates it if it already exists.
 */
drawVerticalPositionLine: function( parent, evt){
    var numX = evt.pageX + 2;

    if( ! this.verticalPositionLine ){
        // if line does not exist, create it
        this.verticalPositionLine = dojo.create( 'div', {
            className: 'trackVerticalPositionIndicatorMain'
        }, this.staticTrack.div );
    }

    var line = this.verticalPositionLine;
    line.style.display = 'block';      //make line visible
    line.style.left = numX+'px'; //set location on screen
    var scaleTrackPos = dojo.position( this.scaleTrackDiv );
    line.style.top =  scaleTrackPos.y + 'px';


    this.drawBasePairLabel({ name: 'single', offset: 0, x: numX, parent: parent });
},

/**
 * Draws the label for the line.
 * @param {Number} args.numX X-coordinate at which to draw the label's origin
 * @param {Number} args.name unique name used to cache this label
 * @param {Number} args.offset offset in pixels from numX at which the label should actually be drawn
 * @param {HTMLElement} args.scaleDiv
 * @param {Function} args.xToBp
 */
drawBasePairLabel: function ( args ){
    var name = args.name || 0;
    var offset = args.offset || 0;
    var numX = args.x;
    this.basePairLabels = this.basePairLabels || {};

    if( ! this.basePairLabels[name] ) {
        var scaleTrackPos = dojo.position( args.scaleDiv || this.scaleTrackDiv );
        this.basePairLabels[name] = dojo.create( 'div', {
            className: 'basePairLabel'+(args.className ? ' '+args.className : '' ),
            style: { top: scaleTrackPos.y + scaleTrackPos.h - 3 + 'px' }
        }, document.body );
    }

    var label = this.basePairLabels[name];

    if (typeof numX == 'object'){
        numX = numX.clientX;
    }

    label.style.display = 'block';      //make label visible
    var absfunc = args.xToBp || dojo.hitch(this,'absXtoBp');
    label.innerHTML = Util.addCommas( Math.floor( absfunc(numX) )); //set text to BP location

    //label.style.top = args.top + 'px';

    // 15 pixels on either side of the label
    if( window.innerWidth - numX > 8 + label.offsetWidth ) {
        label.style.left = numX + offset + 'px'; //set location on screen to the right
    } else {
        label.style.left = numX + 1 - offset - label.offsetWidth + 'px'; //set location on screen to the left
    }
},

/**
 * Turn off the basepair-position line if it is being displayed.
 */
clearVerticalPositionLine: function(){
    if( this.verticalPositionLine )
        this.verticalPositionLine.style.display = 'none';
},

/**
 * Delete any base pair labels that are being displayed.
 */
clearBasePairLabels: function(){
    for( var name in this.basePairLabels ) {
        var label = this.basePairLabels[name];
        if( label.parentNode )
            label.parentNode.removeChild( label );
    }
    this.basePairLabels = {};
},


/**
 * Event handler fired when the track scale bar is single-clicked.
 */
scaleClicked: function( evt ) {
    var bp = this.absXtoBp(evt.clientX);

    this.scaleClickedTimeout = window.setTimeout( dojo.hitch( this, function() {
        this.centerAtBase( bp );
    },100));
},

checkY: function(y) {
    return Math.min((y < 0 ? 0 : y), this.containerHeight - this.getHeight());
},

/**
 * Given a new X and Y pixels position for the main track container,
 * reposition static elements that "float" over it, like track labels,
 * Y axis labels, the main track ruler, and so on.
 *
 * @param [args.x] the new X coordinate.  if not provided,
 *   elements that only need updates on the X position are not
 *   updated.
 * @param [args.y] the new Y coordinate.  if not provided,
 *   elements that only need updates on the Y position are not
 *   updated.
 * @param [args.width] the new width of the view.  if not provided,
 *   elements that only need updates on the width are not
 *   updated.
 * @param [args.height] the new height of the view. if not provided,
 *   elements that only need updates on the height are not
 *   updated.
 */
updateStaticElements: function( args ) {
    this.trackIterate( function(t) {
        t.updateStaticElements( args );
    },this);

    this._updateVerticalScrollBar( args );
},

showWait: function() {
    var oldCursors = [];
    for (var i = 0; i < this.waitElems.length; i++) {
        oldCursors[i] = this.waitElems[i].style.cursor;
        this.waitElems[i].style.cursor = "wait";
    }
    this.prevCursors.push(oldCursors);
},

showDone: function() {
    var oldCursors = this.prevCursors.pop();
    for (var i = 0; i < this.waitElems.length; i++) {
        this.waitElems[i].style.cursor = oldCursors[i];
    }
},

pxToBp: function(pixels) {
    return pixels / this.pxPerBp;
},

/**
 * Convert absolute pixels X position to base pair position on the
 * current reference sequence.
 * @returns {Number}
 */
absXtoBp: function( /**Number*/ pixels) {
    return this.pxToBp( this.getPosition().x + this.offset - dojo.position(this.elem, true).x + pixels );
},

bpToPx: function(bp) {
    return bp * this.pxPerBp;
},


/**
 * Update the view's state, and that of its tracks, for the current
 * width and height of its container.
 * @returns nothing
 */
sizeInit: function() {
    //scale values, in pixels per bp, for all zoom levels
    var desiredZoomLevels = [1/500000, 1/200000, 1/100000, 1/50000, 1/20000, 1/10000, 1/5000, 1/2000, 1/1000, 1/500, 1/200, 1/100, 1/50, 1/20, 1/10, 1/5, 1/2, 1, 2, 5, 10, 20 ];

    this.zoomLevels = [];
    for( var i = 0; i < desiredZoomLevels.length; i++ )  {
	var zlevel = desiredZoomLevels[i];
	if( zlevel < this.maxPxPerBp )
            this.zoomLevels.push( zlevel );
	else
            break; // once get to zoom level >= maxPxPerBp, quit
    }
    this.zoomLevels.push( this.maxPxPerBp );

    //make sure we don't zoom out too far
    while (((this.ref.end - this.ref.start) * this.zoomLevels[0])
           < this.getWidth()) {
        this.zoomLevels.shift();
    }
    this.zoomLevels.unshift(this.getWidth() / (this.ref.end - this.ref.start));

    //width, in pixels, of stripes at min zoom (so the view covers
    //the whole ref seq)
    this.minZoomStripe = this.regularStripe * (this.zoomLevels[0] / this.zoomLevels[1]);

    this.curZoom = 0;
    while (this.pxPerBp > this.zoomLevels[this.curZoom])
        this.curZoom++;
    this.maxLeft = this.bpToPx(this.ref.end+1) - this.getWidth();

    delete this.stripePercent;
    //25, 50, 100 don't work as well due to the way scrollUpdate works
    var possiblePercents = [20, 10, 5, 4, 2, 1];
    for (var i = 0; i < possiblePercents.length; i++) {
        // we'll have (100 / possiblePercents[i]) stripes.
        // multiplying that number of stripes by the minimum stripe width
        // gives us the total width of the "container" div.
        // (or what that width would be if we used possiblePercents[i]
        // as our stripePercent)
        // That width should be wide enough to make sure that the user can
        // scroll at least one page-width in either direction without making
        // the container div bump into the edge of its parent element, taking
        // into account the fact that the container won't always be perfectly
        // centered (it may be as much as 1/2 stripe width off center)
        // So, (this.getWidth() * 3) gives one screen-width on either side,
        // and we add a regularStripe width to handle the slightly off-center
        // cases.
        // The minimum stripe width is going to be halfway between
        // "canonical" zoom levels; the widest distance between those
        // zoom levels is 2.5-fold, so halfway between them is 0.7 times
        // the stripe width at the higher zoom level
        if (((100 / possiblePercents[i]) * (this.regularStripe * 0.7))
            > ((this.getWidth() * 3) + this.regularStripe)) {
            this.stripePercent = possiblePercents[i];
            break;
        }
    }

    if ( ! this.stripePercent ) {
        console.warn("stripeWidth too small: " + this.stripeWidth + ", " + this.getWidth());
        this.stripePercent = 1;
    }

    var oldX;
    var oldStripeCount = this.stripeCount;
    if (oldStripeCount) oldX = this.getX();
    this.stripeCount = Math.round(100 / this.stripePercent);

    this.scrollContainer.style.width =
        (this.stripeCount * this.stripeWidth) + "px";
    this.zoomContainer.style.width =
        (this.stripeCount * this.stripeWidth) + "px";

    var blockDelta = undefined;
    if (oldStripeCount && (oldStripeCount != this.stripeCount)) {
        blockDelta = Math.floor((oldStripeCount - this.stripeCount) / 2);
        var delta = (blockDelta * this.stripeWidth);
        var newX = this.getX() - delta;
        this.offset += delta;
        this.updateStaticElements( { x: newX } );
        this.rawSetX(newX);
    }

    // update the sizes for each of the tracks
    this.trackIterate(function(track, view) {
                          track.sizeInit(view.stripeCount,
                                         view.stripePercent,
                                         blockDelta);
                      });

    var newHeight =
        this.trackHeights && this.trackHeights.length
          ? Math.max(
              dojof.reduce( this.trackHeights, '+') + this.trackPadding * this.trackHeights.length,
              this.getHeight()
            )
          : this.getHeight();
    this.scrollContainer.style.height = newHeight + "px";
    this.containerHeight = newHeight;

    this.updateScroll();
},

/**
 * @private
 */
updateScroll: function() {

    // may need to update our Y position if our height has changed
    var update = { height: this.getHeight() };
    if( this.getY() > 0 ) {
        if( this.containerHeight - this.getY() < update.height ) {
            //console.log( this.totalTrackHeight, update.height, this.getY() );
            update.y = this.setY( Math.max( 0, this.containerHeight - update.height ));
        }
    }

    // update any static (i.e. fixed-position) elements that need to
    // float in one position over the scrolling track div (can't use
    // CSS position:fixed for these)
    this.updateStaticElements( update );
},

trimVertical: function(y) {
    if (y === undefined) y = this.getY();
    var trackBottom;
    var trackTop = this.topSpace;
    var bottom = y + this.getHeight();
    for (var i = 0; i < this.tracks.length; i++) {
        if (this.tracks[i].shown) {
            trackBottom = trackTop + this.trackHeights[i];
            if (!((trackBottom > y) && (trackTop < bottom))) {
                this.tracks[i].hideAll();
            }
            trackTop = trackBottom + this.trackPadding;
        }
    }
},

redrawTracks: function() {
    this.trackIterate( function(t) { t.hideAll(); } );
    this.showVisibleBlocks( false );
},

hideRegion: function( location ) {
    this.trackIterate( function(t) { t.hideRegion( location ); } );
},

redrawRegion: function( location ) {
    this.hideRegion( location );
    this.showVisibleBlocks( false );
},

zoomIn: function(e, zoomLoc, steps) {
    if (this.animation) return;
    this._unsetPosBeforeZoom();
    if (zoomLoc === undefined) zoomLoc = 0.5;
    if (steps === undefined) steps = 1;
    steps = Math.min(steps, (this.zoomLevels.length - 1) - this.curZoom);
    if ((0 == steps) && (this.pxPerBp == this.zoomLevels[this.curZoom]))
        return;

    this.showWait();
    var pos = this.getPosition();
    this.trimVertical(pos.y);

    var scale = this.zoomLevels[this.curZoom + steps] / this.pxPerBp;
    var fixedBp = this.pxToBp(pos.x + this.offset + (zoomLoc * this.getWidth()));
    this.curZoom += steps;
    this.pxPerBp = this.zoomLevels[this.curZoom];
    this.maxLeft = this.bpToPx(this.ref.end+1) - this.getWidth();

    for (var track = 0; track < this.tracks.length; track++)
    this.tracks[track].startZoom(this.pxPerBp,
                     fixedBp - ((zoomLoc * this.getWidth())
                                                / this.pxPerBp),
                     fixedBp + (((1 - zoomLoc) * this.getWidth())
                                                / this.pxPerBp));
    //YAHOO.log("centerBp: " + centerBp + "; estimated post-zoom start base: " + (centerBp - ((zoomLoc * this.getWidth()) / this.pxPerBp)) + ", end base: " + (centerBp + (((1 - zoomLoc) * this.getWidth()) / this.pxPerBp)));

    // Zooms take an arbitrary 700 milliseconds, which feels about right
    // to me, although if the zooms were smoother they could probably
    // get faster without becoming off-putting. -MS
    new Zoomer(scale, this,
               function() {this.zoomUpdate(zoomLoc, fixedBp);},
               700, zoomLoc);
},

/** WebApollo support for zooming directly to base level, and later restoring previous zoom level before zooming to base */
zoomToBaseLevel: function(e, pos) {
    if (this.animation) return;
    //   if (this.zoomLevels[this.curZoom] === this.charWidth)  {  console.log("already zoomed to base level"); return; }
    // if at max zoomLevel then already zoomed to bases, so then no-op
    var baseZoomIndex = this.zoomLevels.length - 1;

    if (this.curZoom === baseZoomIndex)  { console.log("already zoomed to base level"); return; }
    this._setPosBeforeZoom(this.minVisible(), this.maxVisible(), this.curZoom);
    var zoomLoc = 0.5;

    this.showWait();
    this.trimVertical();

    var relativeScale = this.zoomLevels[baseZoomIndex] / this.pxPerBp;
    var fixedBp = pos;
    this.curZoom = baseZoomIndex;
    this.pxPerBp = this.zoomLevels[baseZoomIndex];

    this.maxLeft = (this.pxPerBp * this.ref.end) - this.getWidth();

    for (var track = 0; track < this.tracks.length; track++)
	this.tracks[track].startZoom(this.pxPerBp,
				     fixedBp - ((zoomLoc * this.getWidth())
						/ this.pxPerBp),
				     fixedBp + (((1 - zoomLoc) * this.getWidth())
						/ this.pxPerBp));
    //YAHOO.log("centerBp: " + centerBp + "; estimated post-zoom start base: " + (centerBp - ((zoomLoc * this.getWidth()) / this.pxPerBp)) + ", end base: " + (centerBp + (((1 - zoomLoc) * this.getWidth()) / this.pxPerBp)));
    new Zoomer(relativeScale, this,
               function() {this.zoomUpdate(zoomLoc, fixedBp);},
               700, zoomLoc);
},


zoomOut: function(e, zoomLoc, steps) {
    if (this.animation) return;
    this._unsetPosBeforeZoom();
    if (steps === undefined) steps = 1;
    steps = Math.min(steps, this.curZoom);
    if (0 == steps) return;

    this.showWait();
    var pos = this.getPosition();
    this.trimVertical(pos.y);
    if (zoomLoc === undefined) zoomLoc = 0.5;
    var scale = this.zoomLevels[this.curZoom - steps] / this.pxPerBp;
    var edgeDist = this.bpToPx(this.ref.end) - (this.offset + pos.x + this.getWidth());
        //zoomLoc is a number on [0,1] that indicates
        //the fixed point of the zoom
    zoomLoc = Math.max(zoomLoc, 1 - (((edgeDist * scale) / (1 - scale)) / this.getWidth()));
    edgeDist = pos.x + this.offset - this.bpToPx(this.ref.start);
    zoomLoc = Math.min(zoomLoc, ((edgeDist * scale) / (1 - scale)) / this.getWidth());
    var fixedBp = this.pxToBp(pos.x + this.offset + (zoomLoc * this.getWidth()));
    this.curZoom -= steps;
    this.pxPerBp = this.zoomLevels[this.curZoom];

    for (var track = 0; track < this.tracks.length; track++)
    this.tracks[track].startZoom(this.pxPerBp,
                     fixedBp - ((zoomLoc * this.getWidth())
                                                / this.pxPerBp),
                     fixedBp + (((1 - zoomLoc) * this.getWidth())
                                                / this.pxPerBp));

    //YAHOO.log("centerBp: " + centerBp + "; estimated post-zoom start base: " + (centerBp - ((zoomLoc * this.getWidth()) / this.pxPerBp)) + ", end base: " + (centerBp + (((1 - zoomLoc) * this.getWidth()) / this.pxPerBp)));
    this.minLeft = this.pxPerBp * this.ref.start;

    // Zooms take an arbitrary 700 milliseconds, which feels about right
    // to me, although if the zooms were smoother they could probably
    // get faster without becoming off-putting. -MS
    new Zoomer(scale, this,
               function() {this.zoomUpdate(zoomLoc, fixedBp);},
               700, zoomLoc);
},


/** WebApollo support for zooming directly to base level, and later restoring previous zoom level before zooming to base */
zoomBackOut: function(e) {
    if (this.animation) { return; }
    if (!this.isZoomedToBase()) { return; }

    var min = this.posBeforeZoom.min;
    var max = this.posBeforeZoom.max;
    var zoomIndex = this.posBeforeZoom.zoomIndex;
    this.posBeforeZoom = undefined;

    var zoomLoc = 0.5;
    this.showWait();

    var scale = this.zoomLevels[zoomIndex] / this.pxPerBp;
    var fixedBp = (min + max) / 2;
    this.curZoom = zoomIndex;
    this.pxPerBp = this.zoomLevels[zoomIndex];

    for (var track = 0; track < this.tracks.length; track++) {
    	this.tracks[track].startZoom(this.pxPerBp,
    			fixedBp - ((zoomLoc * this.getWidth())
    					/ this.pxPerBp),
    					fixedBp + (((1 - zoomLoc) * this.getWidth())
    							/ this.pxPerBp));
	}

    this.minLeft = this.pxPerBp * this.ref.start;
    var thisObj = this;
    // Zooms take an arbitrary 700 milliseconds, which feels about right
    // to me, although if the zooms were smoother they could probably
    // get faster without becoming off-putting. -MS
    new Zoomer(scale, this,
	       function() {thisObj.setLocation(thisObj.ref, min, max); thisObj.zoomUpdate(zoomLoc, fixedBp); },
	       700, zoomLoc);
},

/** WebApollo support for zooming directly to base level, and later restoring previous zoom level before zooming to base */
isZoomedToBase: function() {
	return this.posBeforeZoom !== undefined;
},

/** WebApollo support for zooming directly to base level, and later restoring previous zoom level before zooming to base */
_setPosBeforeZoom: function(min, max, zoomIndex) {
    this.posBeforeZoom = { "min": min, "max": max, "zoomIndex": zoomIndex };
},

/** WebApollo support for zooming directly to base level, and later restoring previous zoom level before zooming to base */
_unsetPosBeforeZoom: function() {
	this.posBeforeZoom = undefined;
},

zoomUpdate: function(zoomLoc, fixedBp) {
    var eWidth = this.elem.clientWidth;
    var centerPx = this.bpToPx(fixedBp) - (zoomLoc * eWidth) + (eWidth / 2);
    // stripeWidth: pixels per block
    this.stripeWidth = this.stripeWidthForZoom(this.curZoom);
    this.scrollContainer.style.width =
        (this.stripeCount * this.stripeWidth) + "px";
    this.zoomContainer.style.width =
        (this.stripeCount * this.stripeWidth) + "px";
    var centerStripe = Math.round(centerPx / this.stripeWidth);
    var firstStripe = (centerStripe - ((this.stripeCount) / 2)) | 0;
    this.offset = firstStripe * this.stripeWidth;
    this.maxOffset = this.bpToPx(this.ref.end+1) - this.stripeCount * this.stripeWidth;
    this.maxLeft = this.bpToPx(this.ref.end+1) - this.getWidth();
    this.minLeft = this.bpToPx(this.ref.start);
    this.zoomContainer.style.left = "0px";
    this.setX((centerPx - this.offset) - (eWidth / 2));

    dojo.forEach(this.uiTracks, function(track) { track.clear(); });

    this.trackIterate( function(track) {
        track.endZoom( this.pxPerBp,Math.round(this.stripeWidth / this.pxPerBp));
    });

    this.showVisibleBlocks(true);
    this.showDone();
    this.showCoarse();
},

scrollUpdate: function() {
    var x = this.getX();
    var numStripes = this.stripeCount;
    var cWidth = numStripes * this.stripeWidth;
    var eWidth = this.getWidth();
    //dx: horizontal distance between the centers of
    //this.scrollContainer and this.elem
    var dx = (cWidth / 2) - ((eWidth / 2) + x);
    //If dx is negative, we add stripes on the right, if positive,
    //add on the left.
    //We remove stripes from the other side to keep cWidth the same.
    //The end goal is to minimize dx while making sure the surviving
    //stripes end up in the same place.

    var dStripes = (dx / this.stripeWidth) | 0;
    if (0 == dStripes) return;
    var changedStripes = Math.abs(dStripes);

    var newOffset = this.offset - (dStripes * this.stripeWidth);

    if (this.offset == newOffset) return;
    this.offset = newOffset;

    this.trackIterate(function(track) { track.moveBlocks(dStripes); });

    var newX = x + (dStripes * this.stripeWidth);
    this.updateStaticElements( { x: newX } );
    this.rawSetX(newX);
    var firstVisible = (newX / this.stripeWidth) | 0;
},

trackHeightUpdate: function(trackName, height) {
    var y = this.getY();
    if ( ! (trackName in this.trackIndices)) return;
    var track = this.trackIndices[trackName];
    if (Math.abs(height - this.trackHeights[track]) < 1) return;

    //console.log("trackHeightUpdate: " + trackName + " " + this.trackHeights[track] + " -> " + height);
    // if the bottom of this track is a above the halfway point,
    // and we're not all the way at the top,
    if ((((this.trackTops[track] + this.trackHeights[track]) - y)
         <  (this.getHeight() / 2))
        && (y > 0) ) {
        // scroll so that lower tracks stay in place on screen
        this.setY(y + (height - this.trackHeights[track]));
        //console.log("track " + trackName + ": " + this.trackHeights[track] + " -> " + height + "; y: " + y + " -> " + this.getY());
    }
    this.trackHeights[track] = height;
    this.tracks[track].div.style.height = (height + this.trackPadding) + "px";

    this.layoutTracks();

    this.setY( this.getY() );

    this.updateStaticElements({ height: this.getHeight() });
},

showVisibleBlocks: function(updateHeight, pos, startX, endX) {
    if (pos === undefined) pos = this.getPosition();
    if (startX === undefined) startX = pos.x - (this.drawMargin * this.getWidth());
    if (endX === undefined) endX = pos.x + ((1 + this.drawMargin) * this.getWidth());
    var leftVisible = Math.max(0, (startX / this.stripeWidth) | 0);
    var rightVisible = Math.min(this.stripeCount - 1,
                               (endX / this.stripeWidth) | 0);

    var bpPerBlock = Math.round(this.stripeWidth / this.pxPerBp);

    var startBase = Math.round(this.pxToBp((leftVisible * this.stripeWidth)
                                           + this.offset));
    startBase -= 1;
    var containerStart = Math.round(this.pxToBp(this.offset));
    var containerEnd =
        Math.round(this.pxToBp(this.offset
                               + (this.stripeCount * this.stripeWidth)));

    this.trackIterate(function(track, view) {
                          track.showRange(leftVisible, rightVisible,
                                          startBase, bpPerBlock,
                                          view.pxPerBp,
                                          containerStart, containerEnd);
                      });

    this.updateStaticElements({
                                  height: this.getHeight(),
                                  width: this.getWidth(),
                                  x: this.getX(),
                                  y: this.getY()
                              });

    this.browser.publish( '/jbrowse/v1/n/tracks/redraw' );
},

/**
 * Add the given track configurations to the genome view.
 * @param trackConfigs {Array[Object]} array of track configuration
 * objects to add
 */
showTracks: function( trackConfigs ) {
    // filter out any track configs that are already displayed
    var needed = dojo.filter( trackConfigs, function(conf) {
        return this._getTracks( [conf.label] ).length == 0;
    },this);
    if( ! needed.length ) return;

    // insert the track configs into the trackDndWidget ( the widget
    // will call create() on the confs to render them)
    this.trackDndWidget.insertNodes( false, needed );

    this.updateTrackList();
},

/**
 * Replace the track configurations that are currently visible in the genome view.
 * @param trackConfigs {Array[Object]} array of track configuration
 * objects to add
 */
replaceTracks: function( trackConfigs ) {
    // for each one
    array.forEach( trackConfigs, function( conf ) {
        // figure out its position in the genome view and delete it
        var anchor;
        var done;
        var listNode = this.trackDndWidget.parent;
        array.forEach( listNode.children, function( item ) {
            if( done )
                return;

            var track = item.track;
            if( track && (track.config.label == conf.label) ) {
                done = 1;
                this.trackDndWidget.delItem( item.id );
                if( item && item.parentNode )
                    item.parentNode.removeChild(item);
            } else {
                anchor = item;
            }
        },this);

       this.updateTrackList();

       // insert the new track config into the trackDndWidget after the 'before'
       this.trackDndWidget.insertNodes( false, [conf], false, anchor );
   },this);

    if( trackConfigs.length )
        this.updateTrackList();
},

/**
 * Remove the given track (configs) from the genome view.
 * @param trackConfigs {Array[Object]} array of track configurations
 */
hideTracks: function( /**Array[String]*/ trackConfigs ) {

    // filter out any track configs that are not displayed
    var displayed = dojo.filter( trackConfigs, function(conf) {
        return this._getTracks( [conf.label] ).length != 0;
    },this);
    if( ! displayed.length ) return;

    // remove the track configs from the trackDndWidget ( the widget
    // will call create() on the confs to render them )
    dojo.forEach( displayed, function( conf ) {
        this.trackDndWidget.forInItems(function(obj, id, map) {
            if( conf.label === obj.data.label ) {
                this.trackDndWidget.delItem( id );
                var item = dojo.byId(id);
                if( item && item.parentNode )
                    item.parentNode.removeChild(item);
            }
        },this);
    },this);

    this.updateTrackList();
},

/**
 * Pin the tracks with the given names.  Returns an array with the
 * names of tracks that were actually pinned.
 */
pinTracks: function( /**Array[String]*/ trackNames ) {
    var tracks = this._getTracks( trackNames );
    array.forEach( tracks, function( track ) {
                       track.setPinned(true);
                   });
    this.updateTrackList();
    return array.map( tracks, function(t) { return t.name; } );
},

/**
 * Unpin the tracks with the given names.  Returns an array with the
 * names of tracks that were actually unpinned.
 */
unpinTracks: function( /**Array[String]*/ trackNames ) {
    var tracks = this._getTracks( trackNames );
    array.forEach( tracks, function( track ) {
                       track.setPinned(false);
                   });
    this.updateTrackList();
    return array.map( tracks, function(t) { return t.name; } );
},

/**
 * For an array of track names, get the track object if it exists.
 * @private
 * @returns {Array[Track]} the track objects that were found
 */
_getTracks: function( /**Array[String]*/ trackNames ) {
    var tracks = [],
        tn = { count: trackNames.length };
    dojo.forEach( trackNames, function(n) { tn[n] = 1;} );
    dojo.some( this.tracks, function(t) {
        if( tn[t.name] ) {
            tracks.push(t);
            tn.count--;
        }
        return ! tn.count;
    }, this);
    return tracks;
},

_updateLocationDisplays: function( region ) {
    var positionString = Util.assembleLocStringWithLength( region  );

    if( this.positionDisplay ) {
        this.positionDisplay.innerHTML = positionString;
    }
    if( this.locationBox ) {
        this.locationBox.set(
            'value',
            positionString,
            false //< don't fire any onchange handlers
        );
        this.goButton.set( 'disabled', true ) ;
    }
},

_updateRefSeqSelectBox: function() {
    if( this.refSeqSelectBox ) {

        // if none of the options in the select box match this
        // reference sequence, add another one to the end for it
        if( ! array.some( this.refSeqSelectBox.getOptions(), function( option ) {
                              return option.value == this.ref.name;
                        }, this)
          ) {
              this.refSeqSelectBox.set( 'options',
                                     this.refSeqSelectBox.getOptions()
                                     .concat({ label: this.ref.name, value: this.ref.name })
                                   );
        }

        // set its value to the current ref seq
        this.refSeqSelectBox.set( 'value', this.ref.name, false );
    }
},


zoomTo: function(value) {
    var desiredZoomLevel = Math.round(value/100 * this.zoomLevels.length);
    var steps = desiredZoomLevel - this.curZoom;
    this.zoomIn(undefined,undefined,steps);
},

/**
 * @private
 */
createNavBox: function( parent ) {
    var thisB = this;

    this.positionDisplay = domConstruct.create(
        'div',
        { className: 'pane-position',
          style: 'height:'+this.posHeight+'px'
        },
        parent );

    var navbox = document.createElement("div");
    navbox.className = "nav-controls";
    navbox.style.top = this.topSpace + 'px';
    parent.appendChild(navbox);
    var navboxHideTimeout;

    on( this.positionDisplay, 'mouseover', function() {
            if( navboxHideTimeout )
                window.clearTimeout( navboxHideTimeout );
            navbox.style.display = 'block';
    });
    on( navbox, 'mouseover', function() {
            if( navboxHideTimeout )
                window.clearTimeout( navboxHideTimeout );
    });
    on( navbox, mouse.leave, function() {
            if( navboxHideTimeout )
                window.clearTimeout( navboxHideTimeout );
            navboxHideTimeout = window.setTimeout( function() { navbox.style.display = 'none'; }, 300 );
    });

    var miniTrap = domConstruct.create(
        'div', {
            className: "miniTrap"
        }, navbox );

    // if we have fewer than 30 ref seqs, or `refSeqDropdown: true` is
    // set in the config, then put in a dropdown box for selecting
    // reference sequences
    var refSeqSelectBoxPlaceHolder = dojo.create('span', {}, navbox );

    // make the location box
    this.locationBox = new dijitComboBox(
        {
            id: "location",
            name: "location",
            maxLength: 400,
            searchAttr: "name"
        },
        dojo.create('input', {}, navbox) );
    dojo.style('location', 'height', '18px');
    this.browser.afterMilestone( 'loadNames', dojo.hitch(this, function() {
        if( this.browser.nameStore )
            this.locationBox.set( 'store', this.browser.nameStore );
    }));

    this.locationBox.focusNode.spellcheck = false;
    dojo.query('div.dijitArrowButton', this.locationBox.domNode ).orphan();
    dojo.connect( this.locationBox.focusNode, "keydown", this, function(event) {
                      if (event.keyCode == dojo.keys.ENTER) {
                          this.locationBox.closeDropDown(false);
                          this.browser.navigateTo( this.locationBox.get('value') );
                          this.goButton.set('disabled',true);
                          dojo.stopEvent(event);
                      } else {
                          this.goButton.set('disabled', false);
                      }
                  });
    dojo.connect( this.locationBox.domNode, 'onselectstart', function(evt) { evt.stopPropagation(); return true; });
    // monkey-patch the combobox code to make a few modifications
    (function(){

         // add a moreMatches class to our hacked-in "more options" option
         var dropDownProto = eval(this.locationBox.dropDownClass).prototype;
         var oldCreateOption = dropDownProto._createOption;
         dropDownProto._createOption = function( item ) {
             var option = oldCreateOption.apply( this, arguments );
             if( item.hitLimit )
                 dojo.addClass( option, 'moreMatches');
             return option;
         };

         // prevent the "more matches" option from being clicked
         var oldSetValue = dropDownProto._setValueAttr;
         dropDownProto._setValueAttr = function( value ) {
             if( value.target && value.target.item && value.target.item.hitLimit )
                 return null;
             return oldSetValue.apply( this, arguments );
         };
    }).call(this);

    // make the 'Go' button'
    this.goButton = new dijitButton(
        {
            id: 'GoButton',
            label: 'Go',
            onClick: dojo.hitch( this, function(event) {
                this.navigateTo(this.locationBox.get('value'));
                this.goButton.set('disabled',true);
                dojo.stopEvent(event);
            })
        }, dojo.create('button',{},navbox));

    dojo.style('GoButton', 'height', '18px');

    this.browser.afterMilestone('loadRefSeqs', dojo.hitch( this, function() {
        var refSeqOrder = this.browser.refSeqOrder;

        // make the refseq selection dropdown
        if( refSeqOrder && refSeqOrder.length ) {
            var max = this.browser.config.refSeqSelectorMaxSize || 30;
            var numrefs = Math.min( max, refSeqOrder.length);
            var options = [];
            for ( var i = 0; i < numrefs; i++ ) {
                options.push( { label: refSeqOrder[i], value: refSeqOrder[i] } );
            }
            var tooManyMessage = '(first '+numrefs+' ref seqs)';
            if( refSeqOrder.length > max ) {
                options.push( { label: tooManyMessage , value: tooManyMessage, disabled: true } );
            }
            this.refSeqSelectBox = new dijitSelectBox({
                name: 'refseq',
                value: this.ref ? this.ref.name : null,
                options: options,
                onChange: dojo.hitch(this, function( newRefName ) {
                    // don't trigger nav if it's the too-many message
                    if( newRefName == tooManyMessage ) {
                        this.refSeqSelectBox.set('value', this.refSeq.name );
                        return;
                    }

                    // only trigger navigation if actually switching sequences
                    if( newRefName != this.ref.name ) {
                        this.browser.navigateTo(newRefName);
                    }
                })
            }).placeAt( refSeqSelectBoxPlaceHolder );
        }

        // calculate how big to make the location box:  make it big enough to hold the
        var locLength = this.browser.config.locationBoxLength || function() {
            var refSeqOrder = this.browser.refSeqOrder;
            var allRefs = this.browser.allRefs;

            // if we have no refseqs, just use 20 chars
            if( ! refSeqOrder.length )
                return 20;

            // if there are not tons of refseqs, pick the longest-named
            // one.  otherwise just pick the last one
            var ref = refSeqOrder.length < 1000
                && function() {
                       var longestNamedRef;
                       array.forEach( refSeqOrder, function(name) {
                                          var ref = allRefs[name];
                                          if( ! ref.length )
                                              ref.length = ref.end - ref.start + 1;
                                          if( ! longestNamedRef || longestNamedRef.length < ref.length )
                                              longestNamedRef = ref;
                                      }, this );
                       return longestNamedRef;
                   }.call(this)
                || refSeqOrder.length && allRefs[ refSeqOrder[ refSeqOrder.length - 1 ] ]
                || 20;

            var locstring = Util.assembleLocStringWithLength({ ref: ref.name, start: ref.end-1, end: ref.end, length: ref.length });
            //console.log( locstring, locstring.length );
            return locstring.length;
        }.call(this) || 20;

        this.locationBox.domNode.style.width = locLength+'ex';
    }));


    var zoomOut = document.createElement("input");
    zoomOut.type = "image";
    zoomOut.src = this.browser.resolveUrl( "img/zoom-out-1.png" );
    zoomOut.id = "zoomOut";
    zoomOut.className = "icon nav";
    zoomOut.style.height = "40px";
    navbox.appendChild(zoomOut);
    dojo.connect( zoomOut, "click", this,
                  function(event) {
                      dojo.stopEvent(event);
                     this.zoomOut();
                  });



    var zoomSliderSpan = dojo.create('span', {}, navbox );
    zoomSliderSpan.className = "icon nav";

    var zoomSlider = new dijitSlider({
        id: "zoomSlider",
        name: "slider",
        value: 50,
        minimum: 0,
        maximum: 100,
        intermediateChanges: true,
        showButtons: false,
        style: "width:100px; margin: 7px 0 0 0; display: inline-block",
        onChange: function(value){
            thisB.zoomTo(value);
        }
    }, dojo.create('input',{},zoomSliderSpan) );

    var zoomIn = document.createElement("input");
    zoomIn.type = "image";
    zoomIn.src = this.browser.resolveUrl( "img/zoom-in-1.png" );
    zoomIn.id = "zoomIn";
    zoomIn.className = "icon nav";
    zoomIn.style.height = "40px";
    navbox.appendChild(zoomIn);
    dojo.connect( zoomIn, "click", this,
                  function(event) {
                      dojo.stopEvent(event);
                      this.zoomIn();
                  });


    return navbox;
},

/**
 * Create the DOM elements that will contain the rendering of the
 * given track in this genome view.
 * @private
 * @returns {HTMLElement} the HTML element that will contain the
 *                        rendering of this track
 */
renderTrack: function( /**Object*/ trackConfig ) {
    var thisB = this;

    if( !trackConfig )
        return null;

    // just return its div if this track is already on
    var existingTrack;
    if( dojo.some( this.tracks, function(t) {
            if( t.name == trackConfig.label ) {
                existingTrack = t;
                return true;
            }
            return false;
        })
      ) {
          return existingTrack.div;
      }

    var cssName = function(str) { // replace weird characters and lowercase
        return str.replace(/[^A-Za-z_0-9]/g,'_').toLowerCase();
    };

    var trackName = trackConfig.label;
    var trackDiv = dojo.create('div', {
        className: ['track', cssName('track_'+trackConfig.type), cssName('track_'+trackName)].join(' '),
        id: "track_" + trackName
    });
    trackDiv.trackName = trackName;

    var trackClass, store;

    var makeTrack = dojo.hitch(this, function() {
        var track = new trackClass({
                refSeq: this.ref,
                config: trackConfig,
                changeCallback: dojo.hitch( this, 'showVisibleBlocks', true ),
                trackPadding: this.trackPadding,
                store: store,
                genomeView: this,
                browser: this.browser
            });
        if( typeof store.setTrack == 'function' )
            store.setTrack( track );

        // if we can, check that the current reference sequence is
        // contained in the store
        if( store.hasRefSeq ) {
            store.hasRefSeq(
                this.ref.name,
                function( foundRef ) {
                    if( ! foundRef )
                        new InfoDialog({
                            title: 'No data',
                            content: '<b>'
                              +(trackConfig.key||trackConfig.label)
                              +'</b> contains no data on this'
                              +' reference sequence ('
                              +thisB.ref.name
                              +').'
                        }).show();
                }
            );
        }

        trackDiv.track = track;

        var heightUpdate = dojo.hitch( this, 'trackHeightUpdate', trackName );
        track.setViewInfo( this, heightUpdate, this.stripeCount, trackDiv,
                           this.stripePercent, this.stripeWidth,
                           this.pxPerBp, this.trackPadding);

        track.updateStaticElements({
            x: this.getX(),
            y: this.getY(),
            height: this.getHeight(),
            width: this.getWidth()
         });

        this.updateTrackList();
    });

    // might need to load both the store and the track class, so do it in
    // parallel and have whichever one completes last do the actual
    // track making.

    if( ! trackConfig.store )
        console.warn("configuration for track "+trackConfig.label+" has no store set", trackConfig );


    // get the store
    this.browser.getStore( trackConfig.store, function( s ) {
            store = s;
            if( trackClass && store )
                makeTrack();
        });

    // get the track class
    require( [ trackConfig.type ], function( class_ ) {
        trackClass = class_;
        if( trackClass && store )
            makeTrack();
    });

    return trackDiv;
},

trackIterate: function(callback) {
    var i;
    for (i = 0; i < this.uiTracks.length; i++)
        callback.call(this, this.uiTracks[i], this);
    for (i = 0; i < this.tracks.length; i++)
        callback.call(this, this.tracks[i], this);
},


/* this function must be called whenever tracks in the GenomeView
 * are added, removed, or reordered
 */
updateTrackList: function() {
    var tracks = [],
        oldtracks = dojo.toJson( this.trackIndices || {} );

    // after a track has been dragged, the DOM is the only place
    // that knows the new ordering
    var containerChild = this.trackContainer.firstChild;
    do {
        // this test excludes UI tracks, whose divs don't have a track property
        if (containerChild.track)
            tracks.push(containerChild.track);
    } while ((containerChild = containerChild.nextSibling));

    // sort so that the pinned tracks come first.  also, sorting is
    // not stable in all implementations, need to stabilize it
    // ourselves by doing a schwartzian transform with the indices
    tracks = array.map( tracks, function(t,i) {
                            return [t,i];
                        });
    tracks = tracks.sort( function( a, b ) {
        var ap = a[0].isPinned() ? 1 : 0, bp = b[0].isPinned() ? 1 : 0;
        return (bp - ap) || (a[1] - b[1]);
    });
    tracks = array.map( tracks, function( tr ) { return tr[0]; } );

    // create or destroy the pinned-track underlay as needed
    if( tracks[0] && tracks[0].isPinned() ) {
        if( ! this.pinUnderlay )
            this.pinUnderlay = domConstruct.create('div', {
                                                       className: 'pin_underlay',
                                                       style: 'top: '+this.topSpace
                                                   }, this.scrollContainer );
    }
    else if( this.pinUnderlay ) {
        domConstruct.destroy( this.pinUnderlay );
        delete this.pinUnderlay;
    }

    // set the new tracklist
    var oldTracks = this.tracks;
    this.tracks = tracks;

    // recalculate this.trackHeights and this.trackIndices
    var newIndices = {};
    var newHeights = new Array(this.tracks.length);
    var totalHeight = 0;
    for (var i = 0; i < tracks.length; i++) {
        newIndices[tracks[i].name] = i;
        if (tracks[i].name in this.trackIndices) {
            newHeights[i] = this.trackHeights[this.trackIndices[tracks[i].name]];
        } else {
            newHeights[i] = 0;
        }
        totalHeight += newHeights[i];
        this.trackIndices[tracks[i].name] = i;
    }
    this.trackIndices = newIndices;
    this.trackHeights = newHeights;

    // call destroy on any tracks that are being thrown out
    array.forEach( oldTracks || [], function( track ) {
        if( ! ( track.name in newIndices ) ) {
            Util.removeAttribute( track.div, 'track' ); //< because this file put it there
            track.destroy();
        }
    }, this );

    // lay the tracks out bottom to top
    this.layoutTracks();

    this.updateScroll();

    // publish a message if the visible tracks or their ordering has changed
    if( oldtracks != dojo.toJson( this.trackIndices || {} ) ) {
        this.browser.publish( '/jbrowse/v1/n/tracks/visibleChanged', [this.visibleTrackNames()] );
        this.showVisibleBlocks();
    }
},


/**
 * Lay out all shown tracks.
 */
layoutTracks: function() {
    // lay out the track tops
    var nextTop = this.topSpace;
    var lastTop = 0;
    var pinnedHeight = 0;
    var lastWasPinned = false;
    array.forEach( this.tracks, function( track, i ) {
        this.trackTops[i] = nextTop;
        lastTop = nextTop;

        if( track.isPinned() ) {
            track.div.style.top = nextTop + "px";
            lastWasPinned = true;
        }
        else {
            track.div.style.top = nextTop - this.y + ( lastWasPinned ? 15 : 0 ) + "px";
            lastWasPinned = false;
        }

        if ( track.shown ) {
            nextTop += this.trackHeights[i] + this.trackPadding;
            if( track.isPinned() )
                pinnedHeight = nextTop;
        }

    }, this );
    if( pinnedHeight && this.pinUnderlay ) {
        this.pinUnderlay.style.height = pinnedHeight + 'px';
    }

    this.containerHeight = Math.max( nextTop||0, Math.min( this.getY(), lastTop ) + this.getHeight() );
    this.scrollContainer.style.height = this.containerHeight + "px";
}
});
});

/*

Copyright (c) 2007-2009 The Evolutionary Software Foundation

Created by Mitchell Skinner <mitch_skinner@berkeley.edu>

This package and its accompanying libraries are free software; you can
redistribute it and/or modify it under the terms of the LGPL (either
version 2.1, or at your option, any later version) or the Artistic
License 2.0.  Refer to LICENSE for the full license text.

*/
