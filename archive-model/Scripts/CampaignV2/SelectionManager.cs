using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;

public class SelectionManager : MonoBehaviour
{

    public GameObject selectedObject = null;
    public GameObject selectedObjectClick = null;

    //public int selectedPreviousLayer;

    //public int selectedPreviousLayerClick;

    // public LayerMask outlineLayer; 
    //public string LayerName;

    public const string Layer_Selected = "Outline_1";
    public const string Layer_Hover = "Outline_Hover";
    int defaultLayer => LayerMask.NameToLayer("Default");

    public CampaignV2.CampaignMap gm;

    void Awake() {
         gm = CampaignV2.CampaignMap.Instance;
    }
    
    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        RaycastHit hoverHit;
        Ray hoverRay = Camera.main.ScreenPointToRay(Input.mousePosition);

        if (Physics.Raycast(hoverRay, out hoverHit))
        {
            
            if (hoverHit.collider != null
                && selectedObject != hoverHit.collider.gameObject)
            {
                if (selectedObjectClick != null && selectedObjectClick == hoverHit.collider.gameObject)
                {

                }
                else
                {
                    // do stuff
                    // Debug.Log("hover over object: " + hoverHit.collider.gameObject.name);
                    if (selectedObject != null)
                    {
                        selectedObject.layer = defaultLayer;
                    }
                    HandleLayerSwap(hoverHit.collider.gameObject, Layer_Hover); // TODO: recursively set layer
                    selectedObject = hoverHit.collider.gameObject;
                    gm.campaignMenu.SetObjectSelection(selectedObject);

                }
            }
        }
        else
        {
            if (selectedObject != null)
            {
                selectedObject.layer = defaultLayer;
                selectedObject = null;
                CampaignV2.CampaignMap.Instance.campaignMenu.SetObjectSelection(null);

            }
        }

        // Check if the left mouse button is pressed
        if (Input.GetMouseButtonDown(0))
        {
            // Cast a ray from the camera to the mouse position
            Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
            RaycastHit hit;

            // Perform the raycast and check if it hits something
            if (Physics.Raycast(ray, out hit))
            {
                // Check if the hit object has a collider
                if (hit.collider != null)
                {
                    // Log the name of the object
                    //Debug.Log("Hit object: " + hit.collider.gameObject.name);
                    if (selectedObjectClick != null)
                    {
                        selectedObjectClick.layer = defaultLayer;
                    }

                    // if there is a layer hovered, cancel it
                    if (selectedObject != null)
                    {
                        selectedObject.layer = defaultLayer;
                        selectedObject = null;
                    }

                    // then continue to swap 
                    HandleLayerSwap(hit.collider.gameObject, Layer_Selected); // TODO: recursively set layer
                    selectedObjectClick = hit.collider.gameObject;

                    // shippy needs to also select its destination
                    var location = selectedObjectClick.GetComponent<Celestial>();
                    if (!gm.playerShip.traveling)
                    {
                        if (location != gm.playerShip.atLocation)
                        {
                            gm.playerShip.SetDestination(location);
                            var canTravel = gm.playerShip.atLocation.IsAdjacentToSolarSystem(location.system);
                            Debug.Log($"can travel? {canTravel} {gm.playerShip.atLocation.system.LocationName}-->{location.system.LocationName}");

                            CampaignV2.CampaignMap.Instance.campaignMenu.SetObjectSelectedLocation(location, canTravel);
                        }
                        else
                        {
                            gm.playerShip.SetDestination(null);
                            CampaignV2.CampaignMap.Instance.campaignMenu.SetObjectSelectedLocation(null, false);
                        }
                    }
                    //selectedPreviousLayerClick = selectedObjectClick.layer;
                }
            }
            else
            {
                // Debug.Log("No object hit by the raycast.");
                // if (selectedObjectClick != null)
                // {
                //     selectedObjectClick.layer = defaultLayer;
                // }
            }
        }
    }
    
    void HandleLayerSwap(GameObject clickedObject, string layer)
    {
        clickedObject.layer = LayerMask.NameToLayer(layer);
    }

}
