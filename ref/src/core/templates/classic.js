// Classic: the traditional single-column layout every other template builds on.
(function () {
  const {
    registerSingleColumn, thumbBody,
  } = window.App.TemplateKit;

  registerSingleColumn({
    id: 'classic',
    name: 'Classic',
    description: 'Single-column traditional layout with contact icon row',
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-classic">
        <div class="tt-name center"></div><div class="tt-tag center"></div>
        <div class="tt-row center"><span></span><span></span><span></span></div>
        ${thumbBody()}
      </div>`,
  });
})();
