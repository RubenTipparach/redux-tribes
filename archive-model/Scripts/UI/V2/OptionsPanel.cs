using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

public class OptionsPanel : MonoBehaviour, IPointerClickHandler
{
    public RectTransform panelRectTransform;
    public float slideSpeed = 300f;
    private bool isPanelVisible = false;
    private Vector2 hiddenPosition;
    private Vector2 visiblePosition;
    public float visibleYOffset = 300f;

    public float startingXPosition = -41;

    public float visiblePositionX = 0f;

    void Start()
    {
        // Assuming the panel slides in and out from the left
        hiddenPosition = new Vector2(startingXPosition, panelRectTransform.anchoredPosition.y);
        visiblePosition = new Vector2(visiblePositionX, panelRectTransform.anchoredPosition.y);

        // Start off-screen
        panelRectTransform.anchoredPosition = hiddenPosition;
    }

    void Update()
    {
        Vector2 targetPosition = isPanelVisible ? visiblePosition : hiddenPosition;
        panelRectTransform.anchoredPosition = Vector2.MoveTowards(panelRectTransform.anchoredPosition, targetPosition, slideSpeed * Time.deltaTime);
    }

    public void OnPointerClick(PointerEventData eventData)
    {
        // Toggle visibility
        isPanelVisible = !isPanelVisible;
    }
}