using UnityEngine;
using UnityEngine.EventSystems;

public class ShipSelection : MonoBehaviour//, ITimedSimulator
{
    GameManager gm;
    private void Start()
    {
        gm = GameManager.Instance;
    }

    void Update()
    {
        bool uiRaycastBlock = EventSystem.current.IsPointerOverGameObject();

        if (!uiRaycastBlock)
        {
  
            if((Input.GetKey(KeyCode.LeftControl) &&  Input.GetMouseButtonDown(0))|| Input.GetMouseButtonUp(1))
            {
                AttackSelectShip();
            }
            else if (Input.GetMouseButtonDown(0))
            {

                var shiftHeld = Input.GetKey(KeyCode.LeftShift);
                SelectSpaceship(shiftHeld);
            }
        }
    }

    void SelectSpaceship(bool shiftHeld)
    {
        Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
        RaycastHit hit;

        // Raycast and check if we hit a spaceship's selection collider
        if (Physics.Raycast(ray, out hit))
        {
            // Check if the hit object or its parent has the "Spaceship" tag
            if (hit.collider.attachedRigidbody != null 
                &&  (hit.collider.gameObject.CompareTag("Spaceship") ||
                    hit.collider.gameObject.CompareTag("Armor")))
            {
                var ship = hit.collider.attachedRigidbody.GetComponent<ShipController>();

                if (!shiftHeld)
                {
                    DeselectCurrentSpaceship(); // Deselect the current spaceship if one is selected
                }
                Debug.Log("ship selection detected " + hit.collider.name);
                //selectedSpaceship = hit.collider.gameObject;
                gm.SelectShip(ship, shiftHeld);
                // Implement any logic for highlighting or indicating selection here
                //HighlightSpaceship(selectedSpaceship);
            }
            else
            {
                Debug.Log("ship selection NOT detected " + hit.collider.name);
                // If we clicked on something that's not a spaceship, deselect the current spaceship
                //DeselectCurrentSpaceship();
            }
        }
    }


    void AttackSelectShip()
    {
        Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
        RaycastHit hit;

        // Raycast and check if we hit a spaceship's selection collider
        if (Physics.Raycast(ray, out hit))
        {
            // Check if the hit object or its parent has the "Spaceship" tag
            if (hit.collider.attachedRigidbody != null
                && (hit.collider.gameObject.CompareTag("Spaceship") ||
                    hit.collider.gameObject.CompareTag("Armor")))
            {
                var ship = hit.collider.attachedRigidbody.GetComponent<ShipController>();
                //DeselectCurrentSpaceship(); // Deselect the current spaceship if one is selected

                //selectedSpaceship = hit.collider.gameObject;
                //gm.SelectShip(ship);
                //gm.navController.gameObject.SetActive(true);
                // Implement any logic for highlighting or indicating selection here
                //HighlightSpaceship(selectedSpaceship);

                if (GameManager.Instance.shipSelected != null && ship != GameManager.Instance.shipSelected)
                {
                    GameManager.Instance.shipSelected.SetTarget(ship);
                    GameManager.Instance.uiController.SetTargetSubsystems();
                    GameManager.Instance.uiController.UpdateDistanceIndicator();
                    Debug.Log("targetted ship");
                    GameManager.Instance.uiManagerV2?.UpdateUIStatus(GameManager.Instance.shipSelected);
                    GameManager.Instance.uiManagerV2?.SetPlayerTargetShip(ship);
                    GameManager.Instance.uiManagerV2?.UpdateDistanceIndicator();
                }
            }
            else
            {
                // If we clicked on something that's not a spaceship, deselect the current spaceship
                //DeselectCurrentSpaceship();
            }
        }
    }
 
    void DeselectCurrentSpaceship()
    {
        // Implement any logic for removing highlighting or indications of selection here
        // UnhighlightSpaceship(selectedSpaceship);
        gm.DeselectCurrentSpaceship();
    }

    void HighlightSpaceship(GameObject spaceship)
    {
        // Example: Change the spaceship color to indicate selection
        // Renderer renderer = spaceship.GetComponent<Renderer>();
        // if (renderer)
        // {
        //     renderer.material.color = Color.green; // Change color to green for indication
        // }
    }

    void UnhighlightSpaceship(GameObject spaceship)
    {
        // Revert any changes made in the HighlightSpaceship method
        //     Renderer renderer = spaceship.GetComponent<Renderer>();
        //     if (renderer)
        //     {
        //         renderer.material.color = Color.white; // Change color back to original (assuming it was white)
        //     }
        // 
    }
}