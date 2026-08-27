using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class ShipListPanel : MonoBehaviour
{
    public RectTransform panelRectTransform;
    public Button triggerButton;
    public float slideSpeed = 300f;
    public float hiddenOffset = -100f;  // Configurable offset for hidden state
    private bool isPanelVisible = false;
    private Vector2 hiddenPosition;
    private Vector2 visiblePosition;

    public Sprite expand;
    public Sprite collapse;

    void Start()
    {
        // Set the positions for hidden and visible states
        hiddenPosition = new Vector2(panelRectTransform.anchoredPosition.x, hiddenOffset);
        visiblePosition = new Vector2(panelRectTransform.anchoredPosition.x, 0);

        // Start off-screen based on the hidden offset
        panelRectTransform.anchoredPosition = hiddenPosition;

        // Add click listener to the button
        //triggerButton.onClick.AddListener(TogglePanelVisibility);
        triggerButton.onClick.AddListener(GameManager.Instance.uiManagerV2.playerShipListPanel.TogglePanelVisibility);
        triggerButton.onClick.AddListener(GameManager.Instance.uiManagerV2.enemyShipListPanel.TogglePanelVisibility);


    }

    void Update()
    {
        Vector2 targetPosition = isPanelVisible ? visiblePosition : hiddenPosition;
        panelRectTransform.anchoredPosition = Vector2.MoveTowards(panelRectTransform.anchoredPosition, targetPosition, slideSpeed * Time.deltaTime);
    }

    private void TogglePanelVisibility()
    {
        // Toggle visibility
        isPanelVisible = !isPanelVisible;
        //Debug.Log("toggle panel visible");
        if(isPanelVisible)
        {
            triggerButton.image.sprite = collapse;
        }else{
            triggerButton.image.sprite = expand;
        }
    }

    void OnDestroy()
    {
        // Remove listener to avoid memory leaks
        //triggerButton.onClick.RemoveListener(TogglePanelVisibility);
    }
}